import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { AtelierTaskType } from "@outegro/contracts/atelier";
import { runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import {
  AccessTokenVerifier,
  configureApp,
  DATABASE,
} from "@outegro/nest-common";
import {
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
import { z } from "zod";
import type { AtelierDatabase } from "../common/database.js";
import { cvLinkPaths } from "../cv-links/cv-links.controller.js";
import type {
  StepContext,
  StepHandler,
  StepOutcome,
  TaskOf,
} from "../steps/step-handler.js";
import { STORAGE, type Storage } from "../storage/storage.js";
import { STEP_HANDLERS, STEP_PORTS } from "../worker/worker.service.js";

const ISSUER = "http://identity.test";
const AUDIENCE = "outegro";

export const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export type FakeStep = (
  task: TaskOf<unknown>,
  ctx: StepContext,
) => Promise<StepOutcome> | StepOutcome;

/**
 * Step handlers for tests: each type answers from its default function,
 * unless a test queued one-off answers for it (`script.queue(type, ...)`).
 */
export class ScriptedSteps {
  private readonly queued = new Map<AtelierTaskType, FakeStep[]>();
  readonly calls: { type: AtelierTaskType; taskId: string; attempt: number }[] =
    [];
  constructor(
    private readonly defaults: Partial<Record<AtelierTaskType, FakeStep>>,
  ) {}

  queue(type: AtelierTaskType, ...answers: FakeStep[]) {
    this.queued.set(type, [...(this.queued.get(type) ?? []), ...answers]);
  }

  count(type: AtelierTaskType) {
    return this.calls.filter((call) => call.type === type).length;
  }

  handlers(): Map<AtelierTaskType, StepHandler<never>> {
    const map = new Map<AtelierTaskType, StepHandler<never>>();
    for (const type of Object.keys(this.defaults) as AtelierTaskType[]) {
      const handler: StepHandler<unknown> = {
        type,
        contract: 1,
        input: z.unknown(),
        handle: async (task, ctx) => {
          this.calls.push({ type, taskId: task.id, attempt: task.attempt });
          const next = this.queued.get(type)?.shift();
          const answer = next ?? this.defaults[type];
          if (!answer) throw new Error(`no fake for ${type}`);
          return answer(task, ctx);
        },
      };
      map.set(type, handler as StepHandler<never>);
    }
    return map;
  }
}

/**
 * Real PostgreSQL (the generated migrations), RabbitMQ and Valkey; both
 * roles in one app (orchestrator and worker) with scripted step handlers,
 * files in PostgreSQL (STORAGE_DRIVER=pg) and tokens signed by a local key.
 */
export async function startHarness(script: ScriptedSteps) {
  const [pg, valkey, rabbit] = (await Promise.all([
    startPostgres(),
    startValkey(),
    startRabbit(),
  ])) as [TestPostgres, TestService, TestService];
  await runMigrations(pg.url, migrationsFolder);

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
    PORT: "4998",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    ROLE: "api,worker",
    DATABASE_URL: pg.url,
    VALKEY_URL: valkey.url,
    RABBITMQ_URL: rabbit.url,
    AUTH_JWKS_URL: "http://127.0.0.1:9/jwks.json",
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    DEV_AUTH_JWKS_FILE: "",
    HTTP_RATE_LIMIT_PER_MINUTE: "100000",
    STORAGE_DRIVER: "pg",
    S3_ENDPOINT: "",
    CV_PUBLIC_BASE_URL: "http://cv.test",
    CV_OWNER_COOKIE_SECRET: "test-owner-cookie-secret-0123456789",
    LLM_GATEWAY_URL: "http://127.0.0.1:9",
    ATELIER_TEX_URL: "http://127.0.0.1:9",
    ATELIER_BROWSER_URL: "http://127.0.0.1:9",
    SCHEDULER_INTERVAL_MS: "0",
    STEP_MAX_ATTEMPTS: "3",
    SAFE_MODE: "false",
    WORKER_TASKS: "",
  });
  const { env } = await import("../config/env.js");
  env.reset();
  const { AppModule } = await import("../app.module.js");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoles(["api", "worker"])],
  })
    .overrideProvider(AccessTokenVerifier)
    .useValue(verifier)
    .overrideProvider(STEP_HANDLERS)
    .useValue(script.handlers())
    .overrideProvider(STEP_PORTS)
    .useFactory({
      inject: [STORAGE],
      factory: (storage: Storage) => () => ({
        llm: { generate: () => Promise.reject(new Error("no model in tests")) },
        tex: { render: () => Promise.reject(new Error("no tex in tests")) },
        browser: {
          apply: () => Promise.reject(new Error("no browser in tests")),
        },
        storage,
      }),
    })
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
    {
      excludeFromPrefix: cvLinkPaths,
    },
  );
  await app.init();

  const tokenFor = (userId: string, roles: string[] = ["owner"]) =>
    new SignJWT({ sid: randomUUID(), roles, av: 0 })
      .setProtectedHeader({ alg: "ES256", kid: "test", typ: "at+jwt" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  return {
    app,
    url: pg.url,
    get db() {
      return app.get<AtelierDatabase>(DATABASE).db;
    },
    get<T>(type: abstract new (...args: never[]) => T): T {
      return app.get(type as never) as T;
    },
    storage: () => app.get<Storage>(STORAGE),
    http: () => request(app.getHttpServer()),
    auth: async (userId: string, roles?: string[]) => ({
      authorization: `Bearer ${await tokenFor(userId, roles)}`,
    }),
    async close() {
      await app.close();
      await Promise.all([pg.stop(), valkey.stop(), rabbit.stop()]);
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** Polls until `check` returns a value (not undefined/false) or the time runs out. */
export async function eventually<T>(
  check: () => Promise<T | undefined | false | null>,
  timeoutMs = 20_000,
  label = "condition",
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const value = await check();
      if (value !== undefined && value !== false && value !== null)
        return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${label} not reached in ${timeoutMs} ms${last ? `: ${(last as Error).message}` : ""}`,
  );
}
