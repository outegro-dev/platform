import { fileURLToPath } from "node:url";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import { configureApp } from "@outegro/nest-common";
import { verifyLink } from "@outegro/roulette-engine";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TOKEN = "t".repeat(40);
const ROOT_ONES = "01".repeat(32);
const PUBLIC_SEED = "drand:1234567";
// seed[0] and seed[1] of the control chain (root 32 × 0x01, 1 000 000 links).
const COMMIT =
  "2158ee1c7e99c2a02b2939500b971df4513cc0837bbec0bda2e29f7d2e3d1cd0";
const SEED_1 =
  "ca993cd75e481b9433ea7edcac03172888243cc4cb2cbd8643f185174db13125";

type Chain = { root: string; length: number; publicSeed: string };

let pg: TestPostgres;
const running: NestExpressApplication[] = [];

beforeAll(async () => {
  pg = await startPostgres();
  await runMigrations(
    pg.url,
    fileURLToPath(new URL("../drizzle", import.meta.url)),
  );
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4998",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    INTERNAL_API_TOKEN: TOKEN,
    FAIR_ROLL_ROOT: ROOT_ONES,
    FAIR_ROLL_CHAIN_LENGTH: "1000000",
    FAIR_ROLL_PUBLIC_SEED: PUBLIC_SEED,
  });
});

afterAll(async () => {
  for (const app of running) await app.close();
  await pg?.stop();
});

/** A fresh process image over the same database, optionally with another chain. */
async function boot(chain?: Chain) {
  const { AppModule } = await import("./app.module.js");
  const { chainConfig } = await import("./config/config.js");
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (chain)
    builder = builder.overrideProvider(chainConfig.KEY).useValue(chain);
  const app = configureApp(
    (await builder.compile()).createNestApplication<NestExpressApplication>(),
  );
  await app.init();
  running.push(app);
  const http = () => request(app.getHttpServer());
  const reveal = (round: number | string) =>
    http()
      .post(`/v1/internal/rounds/${round}/reveal`)
      .set("authorization", `Bearer ${TOKEN}`);
  return { app, http, reveal };
}

describe("fair-roll", () => {
  it("publishes the commit and reveals the control round of the Rust prototype", async () => {
    const { http, reveal } = await boot();
    const info = await http()
      .get("/v1/internal/chain")
      .set("authorization", `Bearer ${TOKEN}`)
      .expect(200);
    expect(info.body).toEqual({
      commit: COMMIT,
      publicSeed: PUBLIC_SEED,
      chainLength: 1_000_000,
      lastRevealed: 0,
    });
    const first = await reveal(1).expect(200);
    expect(first.body).toEqual({
      round: 1,
      seed: SEED_1,
      number: 8,
      color: "black",
    });
    expect(await verifyLink(COMMIT, first.body.seed)).toBe(true);
  });

  it("reveals strictly in order: a repeat of the last round, never a future one", async () => {
    const { reveal } = await boot();
    // The engine may crash after asking: the last round comes back unchanged.
    expect((await reveal(1).expect(200)).body.seed).toBe(SEED_1);
    await reveal(3).expect(409);
    const second = await reveal(2).expect(200);
    expect(await verifyLink(SEED_1, second.body.seed)).toBe(true);
    // Round 1 is no longer the last one.
    await reveal(1).expect(409);
    await reveal(0).expect(400);
    await reveal("abc").expect(400);
  });

  it("keeps the order across restarts", async () => {
    const { reveal, http } = await boot();
    await reveal(2).expect(200);
    await reveal(4).expect(409);
    await reveal(3).expect(200);
    const info = await http()
      .get("/v1/internal/chain")
      .set("authorization", `Bearer ${TOKEN}`)
      .expect(200);
    expect(info.body.lastRevealed).toBe(3);
  });

  it("answers concurrent reveals of the same round with one seed", async () => {
    const { reveal } = await boot();
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => reveal(4)),
    );
    expect(answers.every((answer) => answer.status === 200)).toBe(true);
    expect(new Set(answers.map((answer) => answer.body.seed)).size).toBe(1);
  });

  it("refuses callers without the service token", async () => {
    const { http } = await boot();
    await http().post("/v1/internal/rounds/5/reveal").expect(401);
    await http()
      .post("/v1/internal/rounds/5/reveal")
      .set("authorization", `Bearer ${"x".repeat(40)}`)
      .expect(401);
  });

  it("stops at the end of the chain", async () => {
    const { reveal } = await boot({
      root: "02".repeat(32),
      length: 2,
      publicSeed: "short",
    });
    await reveal(1).expect(200);
    await reveal(2).expect(200);
    await reveal(3).expect(422);
  });

  it("refuses to start when the public seed of a published chain changes", async () => {
    await expect(
      boot({ root: "02".repeat(32), length: 2, publicSeed: "another" }),
    ).rejects.toThrow(/FAIR_ROLL_PUBLIC_SEED/);
  });
});
