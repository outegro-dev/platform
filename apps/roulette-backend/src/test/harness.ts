import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { RoundView } from "@outegro/contracts/roulette";
import { runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import {
  AccessTokenVerifier,
  CLOCK,
  configureApp,
  DATABASE,
  ManualClock,
} from "@outegro/nest-common";
import { startValkey, type TestService } from "@outegro/nest-common/testing";
import { Redis } from "ioredis";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import request from "supertest";
import type { RouletteDatabase } from "../common/database.js";
import { FAIR_ROLL, SCHEDULER, WALLET } from "../common/tokens.js";
import { EngineDriver } from "../rounds/engine.driver.js";
import { RoundFeed } from "../rounds/round.feed.js";
import { LocalFairRoll, TestWallet } from "./fakes.js";
import { SharedManualScheduler } from "./manual-scheduler.js";
import { TestSocket } from "./socket-client.js";

export const ORIGIN = "http://localhost:3007";
const ISSUER = "http://identity.test";
const AUDIENCE = "outegro";
export const STARTER_CHIPS = 1000;

export type Harness = Awaited<ReturnType<typeof startHarness>>;
export type Instance = Awaited<ReturnType<Harness["boot"]>>;

/**
 * Real PostgreSQL (migrated with the generated SQL) and Valkey; one manual
 * clock and timeline for every instance; fair-roll and the wallet as shared
 * fakes (one wallet service, however many roulette replicas); access tokens
 * signed with a local ES256 key; real `ws` clients.
 */
export async function startHarness(
  options: { env?: Record<string, string> } = {},
) {
  const [pg, valkey] = (await Promise.all([
    startPostgres(),
    startValkey(),
  ])) as [TestPostgres, TestService];
  await runMigrations(
    pg.url,
    fileURLToPath(new URL("../../drizzle", import.meta.url)),
  );

  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid: "test",
    alg: "ES256",
  };
  const verifier = new AccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: createLocalJWKSet({ keys: [jwk] }),
  });

  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4996",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    VALKEY_URL: valkey.url,
    AUTH_JWKS_URL: "http://127.0.0.1:9/jwks.json",
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    WS_ALLOWED_ORIGINS: ORIGIN,
    HTTP_RATE_LIMIT_PER_MINUTE: "100000",
    FAIR_ROLL_URL: "http://127.0.0.1:9",
    INTERNAL_API_TOKEN: "t".repeat(40),
    ROULETTE_STARTER_CHIPS: String(STARTER_CHIPS),
    // Each test file runs in its own module graph, so env() is read afresh.
    ...options.env,
  });

  const clock = new ManualClock(new Date("2026-10-28T10:00:00.000Z"));
  const scheduler = new SharedManualScheduler(clock);
  const fair = new LocalFairRoll();
  const wallet = new TestWallet(STARTER_CHIPS);
  const raw = new Redis(valkey.url);
  const instances: NestExpressApplication[] = [];

  async function boot(name: string = randomUUID()) {
    const { AppModule } = await import("../app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(SCHEDULER)
      .useValue(scheduler.view(name))
      .overrideProvider(FAIR_ROLL)
      .useValue(fair)
      .overrideProvider(WALLET)
      .useValue(wallet)
      .overrideProvider(AccessTokenVerifier)
      .useValue(verifier)
      .compile();
    const app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(),
    );
    await app.listen(0, "127.0.0.1");
    instances.push(app);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const http = () => request(app.getHttpServer());

    async function ticketFor(userId: string): Promise<string> {
      const response = await http()
        .post("/v1/ws-tickets")
        .set(await auth(userId))
        .expect(201);
      return response.body.ticket as string;
    }

    /** Opens a socket for the user and waits for `session.ready`. */
    async function connect(userId: string = randomUUID()) {
      const socket = await TestSocket.open(
        `ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(await ticketFor(userId))}`,
        ORIGIN,
      );
      const ready = await socket.next("session.ready");
      return Object.assign(socket, { userId, ready: ready.payload });
    }

    /** Waits until this instance's feed shows a round frame that passes. */
    async function round(
      accept: (view: RoundView) => boolean,
      timeoutMs = 5000,
    ): Promise<RoundView> {
      const feed = app.get(RoundFeed);
      const until = Date.now() + timeoutMs;
      for (;;) {
        const view = feed.cached();
        if (view && accept(view)) return view;
        if (Date.now() > until)
          throw new Error(
            `round frame never matched; last: ${JSON.stringify(view && { round: view.round, phase: view.phase })}`,
          );
        await sleep(10);
      }
    }

    return {
      name,
      app,
      port,
      http,
      ticketFor,
      connect,
      round,
      driver: app.get(EngineDriver),
      close: () => app.close(),
    };
  }

  const tokenFor = (userId: string) =>
    new SignJWT({ sid: randomUUID(), roles: [], av: 0 })
      .setProtectedHeader({ alg: "ES256", kid: "test", typ: "at+jwt" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  const auth = async (userId: string) => ({
    authorization: `Bearer ${await tokenFor(userId)}`,
  });

  return {
    clock,
    scheduler,
    fair,
    wallet,
    /** Raw Valkey client without the service prefix, for inspection. */
    valkey: raw,
    boot,
    auth,
    advance: (ms: number) => scheduler.advance(ms),
    db: (instance: { app: NestExpressApplication }) =>
      instance.app.get<RouletteDatabase>(DATABASE).db,
    async stop() {
      for (const app of instances) await app.close().catch(() => undefined);
      raw.disconnect();
      await Promise.all([pg.stop(), valkey.stop()]);
    },
  };
}
