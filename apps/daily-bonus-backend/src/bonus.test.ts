import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import {
  AccessTokenVerifier,
  CLOCK,
  configureApp,
  DATABASE,
  ManualClock,
} from "@outegro/nest-common";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultPrizes } from "./bonus/rules.js";
import type { DailyDatabase } from "./common/database.js";
import { IDENTITY, PRIZE_RANDOM, WALLET } from "./common/tokens.js";
import { adminAudit } from "./db/schema.js";
import type { IdentityPort, IdentityUser } from "./identity/identity.js";
import { InMemoryDailyWallet } from "./wallet/wallet.js";

const ISSUER = "http://identity.test";
const AUDIENCE = "outegro";
const HOUR = 60 * 60 * 1000;

class TestIdentity implements IdentityPort {
  readonly users = new Map<string, Partial<IdentityUser>>();
  constructor(private readonly clock: ManualClock) {}
  async lookup(userId: string): Promise<IdentityUser> {
    return {
      status: "active",
      emailVerified: true,
      accessVersion: 0,
      // Old enough unless a test says otherwise.
      createdAt: new Date(this.clock.now().getTime() - 30 * 24 * HOUR),
      ...this.users.get(userId),
    };
  }
}

let pg: TestPostgres;
let app: NestExpressApplication;
let sign: (userId: string, roles?: string[], av?: number) => Promise<string>;
const clock = new ManualClock(new Date("2026-10-28T10:00:00.000Z"));
const identity = new TestIdentity(clock);
const wallet = new InMemoryDailyWallet(0);
/** The prize draw: the next values it returns, then 0 (the first line). */
const draws: number[] = [];

beforeAll(async () => {
  pg = await startPostgres();
  await runMigrations(
    pg.url,
    fileURLToPath(new URL("../drizzle", import.meta.url)),
  );
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" };
  sign = (userId, roles = [], av = 0) =>
    new SignJWT({ sid: randomUUID(), roles, av })
      .setProtectedHeader({ alg: "ES256", kid: "test", typ: "at+jwt" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4995",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    AUTH_JWKS_URL: "http://127.0.0.1:9/jwks.json",
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    AUTH_INTERNAL_URL: "http://127.0.0.1:9",
    INTERNAL_API_TOKEN: "t".repeat(40),
    DAILY_HASH_PEPPER: "p".repeat(40),
  });
  const { AppModule } = await import("./app.module.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(IDENTITY)
    .useValue(identity)
    .overrideProvider(WALLET)
    .useValue(wallet)
    .overrideProvider(PRIZE_RANDOM)
    .useValue(() => draws.shift() ?? 0)
    .overrideProvider(AccessTokenVerifier)
    .useValue(
      new AccessTokenVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
    )
    .compile();
  app = configureApp(moduleRef.createNestApplication());
  // The BFF is the one proxy hop: X-Forwarded-For carries the player's address.
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

const http = () => request(app.getHttpServer());

async function claim(
  userId: string,
  expected: number,
  client: { ip?: string; device?: string } = {},
) {
  const octet = () => Math.floor(Math.random() * 250);
  return http()
    .post("/v1/daily/claim")
    .set("authorization", `Bearer ${await sign(userId)}`)
    .set("x-forwarded-for", client.ip ?? `10.0.${octet()}.${octet()}`)
    .set("x-device-id", client.device ?? randomUUID().replaceAll("-", ""))
    .expect(expected);
}

async function status(userId: string) {
  return (
    await http()
      .get("/v1/daily")
      .set("authorization", `Bearer ${await sign(userId)}`)
      .expect(200)
  ).body;
}

describe("daily bonus", () => {
  it("credits a prize from the table once, then waits 24 hours from the claim", async () => {
    const userId = randomUUID();
    expect(await status(userId)).toMatchObject({
      available: true,
      nextAt: null,
      blocked: null,
      streak: 0,
      prizes: defaultPrizes,
    });
    draws.push(0.999); // the last line: 5 000
    const first = await claim(userId, 200);
    expect(first.body).toMatchObject({
      claimNo: 1,
      prizeIndex: 6,
      basePrize: 5000,
      prize: 5000,
      streak: 1,
      balance: 5000,
    });
    expect(wallet.calls.at(-1)).toMatchObject({
      ref: `daily:${userId}:1`,
      amount: 5000,
      objectRef: "claim:1",
    });
    // A double click right away gets the same claim, no second credit.
    const again = await claim(userId, 200);
    expect(again.body.claimNo).toBe(1);
    expect(wallet.balanceOf(userId)).toBe(5000);

    clock.advance(23 * HOUR);
    const early = await claim(userId, 409);
    expect(early.body.error.fieldErrors.nextAt).toEqual([first.body.nextAt]);
    expect(await status(userId)).toMatchObject({
      available: false,
      nextAt: first.body.nextAt,
    });
    clock.advance(HOUR);
    expect((await status(userId)).available).toBe(true);
  });

  it("adds 10 % a day in a row up to 60 %, and starts over after a gap", async () => {
    const userId = randomUUID();
    const prizes: number[] = [];
    for (let day = 0; day < 8; day++) {
      draws.push(0.7); // the third line: 100
      const response = await claim(userId, 200);
      prizes.push(response.body.prize);
      clock.advance(25 * HOUR);
    }
    expect(prizes).toEqual([100, 110, 120, 130, 140, 150, 160, 160]);
    expect((await status(userId)).streak).toBe(8);
    clock.advance(30 * HOUR); // 55 h since the last bonus: the streak is gone
    draws.push(0.7);
    const after = await claim(userId, 200);
    expect(after.body).toMatchObject({ streak: 1, prize: 100 });
    clock.advance(25 * HOUR);
  });

  it("refuses unverified, new and closed accounts", async () => {
    const unverified = randomUUID();
    identity.users.set(unverified, { emailVerified: false });
    const response = await claim(unverified, 403);
    expect(response.body.error.fieldErrors.reason).toEqual([
      "email_unverified",
    ]);
    expect((await status(unverified)).blocked).toBe("email_unverified");

    const fresh = randomUUID();
    identity.users.set(fresh, {
      createdAt: new Date(clock.now().getTime() - HOUR),
    });
    expect((await claim(fresh, 403)).body.error.fieldErrors.reason).toEqual([
      "account_too_new",
    ]);

    const closed = randomUUID();
    identity.users.set(closed, { status: "suspended" });
    expect((await claim(closed, 403)).body.error.fieldErrors.reason).toEqual([
      "account_closed",
    ]);
  });

  it("gives one network or device at most three bonuses a day over all accounts", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 3; i++) await claim(randomUUID(), 200, { ip });
    const fourth = await claim(randomUUID(), 429, { ip });
    expect(fourth.body.error.fieldErrors.reason).toEqual(["ip_limit"]);

    const device = "d".repeat(32);
    for (let i = 0; i < 3; i++) await claim(randomUUID(), 200, { device });
    expect(
      (await claim(randomUUID(), 429, { device })).body.error.fieldErrors
        .reason,
    ).toEqual(["device_limit"]);

    // The console sees both as suspicions, never the address itself.
    const overview = await http()
      .get("/v1/admin/daily")
      .set("authorization", `Bearer ${await sign(randomUUID(), ["support"])}`)
      .expect(200);
    const kinds = overview.body.suspicions.map((s: { kind: string }) => s.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["shared_ip", "shared_device"]),
    );
    expect(JSON.stringify(overview.body)).not.toContain(ip);
    clock.advance(25 * HOUR);
  });

  it("keeps a claim the wallet did not confirm and finishes it on retry", async () => {
    const userId = randomUUID();
    draws.push(0.1); // 25
    wallet.failNext = 1;
    await claim(userId, 503);
    expect(wallet.balanceOf(userId)).toBe(0);
    const retry = await claim(userId, 200);
    expect(retry.body).toMatchObject({ claimNo: 1, prize: 25, balance: 25 });
    expect(
      wallet.calls.filter((call) => call.ref === `daily:${userId}:1`),
    ).toHaveLength(2);
    expect(wallet.balanceOf(userId)).toBe(25);
  });

  it("changes the prize table with a preview, the version and the audit", async () => {
    const owner = randomUUID();
    const auth = async (av = 0) => `Bearer ${await sign(owner, ["owner"], av)}`;
    const overview = (
      await http()
        .get("/v1/admin/daily")
        .set("authorization", await auth())
        .expect(200)
    ).body;
    expect(overview.expectedPrize).toBeCloseTo(143.25);
    const body = {
      enabled: true,
      streaksEnabled: false,
      prizes: [
        { amount: 100, chance: 0.5 },
        { amount: 300, chance: 0.5 },
      ],
      expectedVersion: overview.settings.version,
      reason: "smaller table",
    };
    const preview = await http()
      .post("/v1/admin/daily/settings")
      .set("authorization", await auth())
      .send({ ...body, preview: true })
      .expect(200);
    expect(preview.body).toMatchObject({
      preview: true,
      expectedPrizeAfter: 200,
    });
    await http()
      .post("/v1/admin/daily/settings")
      .set("authorization", await auth())
      .send({ ...body, prizes: [{ amount: 100, chance: 0.4 }] })
      .expect(400);
    await http()
      .post("/v1/admin/daily/settings")
      .set("authorization", `Bearer ${await sign(randomUUID(), ["support"])}`)
      .send(body)
      .expect(403);
    const done = await http()
      .post("/v1/admin/daily/settings")
      .set("authorization", await auth())
      .send(body)
      .expect(200);
    expect(done.body.after).toMatchObject({
      streaksEnabled: false,
      version: body.expectedVersion + 1,
    });
    await http()
      .post("/v1/admin/daily/settings")
      .set("authorization", await auth())
      .send(body)
      .expect(409);
    const audit = await app
      .get<DailyDatabase>(DATABASE)
      .db.select()
      .from(adminAudit);
    expect(audit).toHaveLength(1);

    const userId = randomUUID();
    draws.push(0.9);
    expect((await claim(userId, 200)).body).toMatchObject({
      prize: 300,
      streak: 1,
    });

    // Turned off: nobody can take it.
    await http()
      .post("/v1/admin/daily/settings")
      .set("authorization", await auth())
      .send({
        ...body,
        enabled: false,
        expectedVersion: body.expectedVersion + 1,
      })
      .expect(200);
    expect(
      (await claim(randomUUID(), 403)).body.error.fieldErrors.reason,
    ).toEqual(["disabled"]);
  });
});
