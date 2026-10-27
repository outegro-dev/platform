import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  createEvent,
  identityRoleBindingChanged,
  identityUserStatusChanged,
} from "@outegro/contracts";
import { createDatabase, runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import {
  AccessTokenVerifier,
  CLOCK,
  configureApp,
  DATABASE,
  ManualClock,
  Metrics,
} from "@outegro/nest-common";
import {
  metricValue,
  startRabbit,
  startValkey,
  type TestService,
} from "@outegro/nest-common/testing";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import request from "supertest";
import type { WalletDatabase } from "../common/database.js";
import { IdentityConsumer } from "../events/identity.consumer.js";
import { JSON_LIMIT } from "../internal/internal.controller.js";
import { ReconciliationService } from "../reconciliation/reconciliation.service.js";

const ISSUER = "http://identity.test";
const AUDIENCE = "outegro";

export const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/**
 * Real PostgreSQL 18, Valkey and RabbitMQ; a manual clock; access tokens
 * signed with a local ES256 key. As in production, the service and its
 * migrations run as the owner role of their own database, not as a
 * superuser: the privileges the migrations take away really are gone.
 */
export async function startHarness() {
  const [pg, valkey, rabbit] = (await Promise.all([
    startPostgres(),
    startValkey(),
    startRabbit(),
  ])) as [TestPostgres, TestService, TestService];

  const admin = createDatabase({ url: pg.url });
  await admin.pool.query("create role wallet login password 'wallet'");
  await admin.pool.query("create database wallet owner wallet");
  await admin.close();
  const appUrl = new URL(pg.url);
  appUrl.username = "wallet";
  appUrl.password = "wallet";
  appUrl.pathname = "/wallet";
  /** The superuser on the wallet database: tests break things with it. */
  const rootUrl = new URL(pg.url);
  rootUrl.pathname = "/wallet";
  await runMigrations(appUrl.toString(), migrationsFolder);

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

  const internalToken = randomBytes(32).toString("hex");
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4993",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: appUrl.toString(),
    VALKEY_URL: valkey.url,
    RABBITMQ_URL: rabbit.url,
    // Unused: tokens are verified with the local key above.
    AUTH_JWKS_URL: "http://127.0.0.1:9/jwks.json",
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    INTERNAL_API_TOKEN: internalToken,
    HTTP_RATE_LIMIT_PER_MINUTE: "100000",
    WALLET_ADMIN_MAX_AMOUNT: "1000000",
    SAFE_MODE: "false",
  });

  const clock = new ManualClock(new Date("2026-10-28T10:00:00.000Z"));
  const { AppModule } = await import("../app.module.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(AccessTokenVerifier)
    .useValue(verifier)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
    { jsonLimit: JSON_LIMIT },
  );
  // Listening once lets supertest reuse the server for parallel requests.
  await app.listen(0, "127.0.0.1");

  const tokenFor = (userId: string, roles: string[] = [], accessVersion = 0) =>
    new SignJWT({ sid: randomUUID(), roles, av: accessVersion })
      .setProtectedHeader({ alg: "ES256", kid: "test", typ: "at+jwt" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  const auth = async (
    userId: string,
    roles: string[] = [],
    accessVersion = 0,
  ) => ({
    authorization: `Bearer ${await tokenFor(userId, roles, accessVersion)}`,
  });
  const http = () => request(app.getHttpServer());
  const service = { authorization: `Bearer ${internalToken}` };
  const root = createDatabase({ url: rootUrl.toString() });

  /** A status change as Identity publishes it: every change bumps accessVersion. */
  const statusEvent = (
    userId: string,
    status: "active" | "suspended" | "deleted",
    accessVersion: number,
  ) =>
    createEvent(identityUserStatusChanged, {
      aggregateId: userId,
      aggregateVersion: accessVersion,
      payload: { userId, status, accessVersion },
    });

  /** A role granted in Identity: it bumps accessVersion too, not the status. */
  const roleEvent = (userId: string, roleKey: string, accessVersion: number) =>
    createEvent(identityRoleBindingChanged, {
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      payload: {
        bindingId: randomUUID(),
        userId,
        roleKey,
        scope: "platform",
        state: "active",
        accessVersion,
      },
    });

  return {
    app,
    clock,
    http,
    auth,
    /** Headers of a platform service on the internal API. */
    service,
    appUrl: appUrl.toString(),
    /** The superuser on the wallet database, to corrupt caches on purpose. */
    root: root.pool,
    get db() {
      return app.get<WalletDatabase>(DATABASE).db;
    },
    identity: () => app.get(IdentityConsumer),
    reconciliation: () => app.get(ReconciliationService),
    statusEvent,
    roleEvent,
    async metric(name: string, labels: Record<string, string> = {}) {
      return metricValue(await app.get(Metrics).scrape(), name, labels);
    },
    async close() {
      await app.close();
      await root.close();
      await Promise.all([pg.stop(), valkey.stop(), rabbit.stop()]);
    },
  };
}

/** The ledger's invariants, straight from the tables. */
export async function invariants(h: Harness) {
  const { rows } = await h.root.query<{
    drift: string;
    chain: string;
    system: string;
    total: string;
    negative: string;
  }>(`
    select
      (select count(*) from wallets w where w.balance <> coalesce(
        (select sum(amount) from wallet_tx t where t.user_id = w.user_id and t.unit = w.unit), 0)
      )::text as drift,
      (select count(*) from wallets w where w.version <> (
        select count(*) from wallet_tx t where t.user_id = w.user_id and t.unit = w.unit)
      )::text as chain,
      (select count(*) from system_accounts a where a.balance <> coalesce(
        (select -sum(amount) from wallet_tx t where t.counter_account = a.code and t.unit = a.unit), 0)
      )::text as system,
      ((select coalesce(sum(balance), 0) from wallets)
        + (select coalesce(sum(balance), 0) from system_accounts))::text as total,
      (select count(*) from wallets where balance < 0)::text as negative
  `);
  const row = rows[0];
  return {
    /** Wallets whose cache is not the sum of their journal. */
    drift: Number(row?.drift),
    /** Wallets whose version is not their number of operations. */
    chain: Number(row?.chain),
    /** System accounts that are not minus the sum of their legs. */
    system: Number(row?.system),
    /** All accounts of GRM together: always zero. */
    total: BigInt(row?.total ?? "NaN"),
    negative: Number(row?.negative),
  };
}
