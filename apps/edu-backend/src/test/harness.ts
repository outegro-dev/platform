import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  type AnyEvent,
  billingGrantChanged,
  createEvent,
  identityRoleBindingChanged,
  identityUserStatusChanged,
} from "@outegro/contracts";
import {
  type AssistEvent,
  assistEventSchema,
  eduFeatures,
} from "@outegro/contracts/edu";
import { runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import {
  AccessTokenVerifier,
  CLOCK,
  configureApp,
  DATABASE,
  ManualClock,
  Messaging,
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
import { ASSIST_TIMING, type AssistTiming } from "../assist/settings.js";
import type { EduDatabase } from "../common/database.js";
import type { AssistConfig } from "../config/config.js";
import { type ImportLog, importBundledBooks } from "../content/import.js";
import { TEXT_MODEL } from "../domain/assist/text-model.js";
import { ScriptedModel } from "./scripted-model.js";

const ISSUER = "http://identity.test";
const AUDIENCE = "outegro";

export const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);
/** The real content/: manifest and both books. */
export const contentDir = new URL("../../content", import.meta.url);
export const silentLog: ImportLog = () => undefined;

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** The `data:` events of a Server-Sent Events body; keep-alive comments skipped. */
export function eventsOf(body: string): AssistEvent[] {
  return body
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => assistEventSchema.parse(JSON.parse(block.slice(6))));
}

/** Short enough for tests, long enough not to fire by accident. */
export const testTiming: AssistTiming = {
  keepAliveMs: 40,
  slotWaitMs: 400,
  retryDelayMs: 0,
};

/**
 * Real PostgreSQL (the generated migrations, then the import of the real
 * content/), Valkey and RabbitMQ; a manual clock; access tokens signed with a
 * local ES256 key; the assistant on, with a scripted model instead of the
 * provider (no call ever leaves the process) and a config tests may change.
 */
export async function startHarness() {
  const [pg, valkey, rabbit] = (await Promise.all([
    startPostgres(),
    startValkey(),
    startRabbit(),
  ])) as [TestPostgres, TestService, TestService];
  const clock = new ManualClock(new Date("2026-09-29T10:00:00.000Z"));
  await runMigrations(pg.url, migrationsFolder);
  await importBundledBooks(pg.url, contentDir, silentLog, { clock });

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
    PORT: "4995",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    VALKEY_URL: valkey.url,
    RABBITMQ_URL: rabbit.url,
    // Unused: tokens are verified with the local key above.
    AUTH_JWKS_URL: "http://127.0.0.1:9/jwks.json",
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    HTTP_RATE_LIMIT_PER_MINUTE: "100000",
    // A local .env may hold a real provider key; the process value wins over
    // it, so the key never reaches a test (the model is scripted anyway).
    MINIMAX_API_KEY: "",
    ASSIST_ENABLED: "false",
    SAFE_MODE: "false",
  });

  const model = new ScriptedModel();
  /** Read on every request: tests turn the assistant off and on through it. */
  const assistConfig: AssistConfig = {
    enabled: true,
    apiKey: "test-key-never-sent",
    baseUrl: "http://127.0.0.1:9",
    model: model.name,
    dailyLimit: 30,
    globalDailyLimit: 500,
    maxTokens: 1800,
    timeoutMs: 90_000,
    concurrency: 2,
  };
  const { AppModule } = await import("../app.module.js");
  const config = await import("../config/config.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(AccessTokenVerifier)
    .useValue(verifier)
    .overrideProvider(config.assistConfig.KEY)
    .useValue(assistConfig)
    .overrideProvider(TEXT_MODEL)
    .useValue(model)
    .overrideProvider(ASSIST_TIMING)
    .useValue(testTiming)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
  );
  await app.init();

  const tokenFor = (userId: string, roles: string[] = [], accessVersion = 0) =>
    new SignJWT({ sid: randomUUID(), roles, av: accessVersion })
      .setProtectedHeader({ alg: "ES256", kid: "test", typ: "at+jwt" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  const http = () => request(app.getHttpServer());

  /** The app on a real port, for streams a test reads as they come. */
  let origin: string | null = null;
  async function baseUrl() {
    if (!origin) {
      await app.listen(0, "127.0.0.1");
      const { port } = app.getHttpServer().address() as AddressInfo;
      origin = `http://127.0.0.1:${port}`;
    }
    return origin;
  }
  const auth = async (
    userId: string,
    roles: string[] = [],
    accessVersion = 0,
  ) => ({
    authorization: `Bearer ${await tokenFor(userId, roles, accessVersion)}`,
  });

  /** Publishes an event as its producer would (through RabbitMQ). */
  async function publish(event: AnyEvent) {
    await app.get(Messaging).publish(`${event.producer}.events`, event);
  }

  let grantVersion = 0;
  function grantEvent(input: {
    userId: string;
    feature?: string;
    grantId?: string;
    version?: number;
    state?: "active" | "revoked" | "expired";
    validFrom?: string;
    validUntil?: string | null;
    service?: string;
  }) {
    const grantId = input.grantId ?? randomUUID();
    return createEvent(billingGrantChanged, {
      aggregateId: grantId,
      aggregateVersion: input.version ?? ++grantVersion,
      payload: {
        grantId,
        userId: input.userId,
        service: input.service ?? "edu",
        feature: input.feature ?? eduFeatures.library,
        sourceType: "purchase",
        sourceId: randomUUID(),
        state: input.state ?? "active",
        validFrom:
          input.validFrom ??
          new Date(clock.now().getTime() - 60_000).toISOString(),
        validUntil: input.validUntil ?? null,
      },
    });
  }

  /** A status change as Identity publishes it: every change bumps accessVersion. */
  function statusEvent(
    userId: string,
    status: "active" | "suspended" | "deleted",
    accessVersion: number,
  ) {
    return createEvent(identityUserStatusChanged, {
      aggregateId: userId,
      aggregateVersion: accessVersion,
      payload: { userId, status, accessVersion },
    });
  }

  /** A role granted in Identity: it bumps accessVersion too, not the status. */
  function roleEvent(userId: string, roleKey: string, accessVersion: number) {
    return createEvent(identityRoleBindingChanged, {
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
  }

  return {
    clock,
    url: pg.url,
    app,
    model,
    assistConfig,
    baseUrl,
    get db() {
      return app.get<EduDatabase>(DATABASE).db;
    },
    get<T>(type: abstract new (...args: never[]) => T): T {
      return app.get(type as never) as T;
    },
    http,
    auth,
    tokenFor,
    publish,
    grantEvent,
    statusEvent,
    roleEvent,
    /** Sum of the series of `name` with these labels in a fresh scrape. */
    async metric(name: string, labels: Record<string, string> = {}) {
      return metricValue(await app.get(Metrics).scrape(), name, labels);
    },
    async close() {
      await app.close();
      await Promise.all([pg.stop(), valkey.stop(), rabbit.stop()]);
    },
  };
}
