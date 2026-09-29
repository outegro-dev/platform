import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { SeededRandom } from "@outegro/battleship-engine";
import {
  type AnyEvent,
  billingGrantChanged,
  createEvent,
  defineQueue,
  identityUserStatusChanged,
} from "@outegro/contracts";
import { battleshipFeatures } from "@outegro/contracts/battleship";
import { runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import {
  AccessTokenVerifier,
  CLOCK,
  configureApp,
  DATABASE,
  ManualClock,
  Messaging,
} from "@outegro/nest-common";
import {
  startRabbit,
  startValkey,
  type TestService,
} from "@outegro/nest-common/testing";
import { Redis } from "ioredis";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import request from "supertest";
import type { BattleshipDatabase } from "../common/database.js";
import { RANDOM, SCHEDULER } from "../common/tokens.js";
import { ManualScheduler } from "./manual-scheduler.js";
import { TestSocket } from "./socket-client.js";

export const ORIGIN = "http://localhost:3005";
const ISSUER = "http://identity.test";
const AUDIENCE = "outegro";

export type Harness = Awaited<ReturnType<typeof startHarness>>;

type Running = {
  app: NestExpressApplication;
  scheduler: ManualScheduler;
  port: number;
};

/**
 * Real PostgreSQL (migrated with the generated SQL), Valkey and RabbitMQ;
 * a manual clock and scheduler; access tokens signed with a local ES256 key;
 * the app listening on a free port for real `ws` clients. `restart()` swaps
 * the app for a fresh process image over the same infrastructure.
 */
export async function startHarness(options: { seed?: number } = {}) {
  const [pg, valkey, rabbit] = (await Promise.all([
    startPostgres(),
    startValkey(),
    startRabbit(),
  ])) as [TestPostgres, TestService, TestService];
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
    PORT: "4997",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    VALKEY_URL: valkey.url,
    RABBITMQ_URL: rabbit.url,
    // Unused: tokens are verified with the local key above.
    AUTH_JWKS_URL: "http://127.0.0.1:9/jwks.json",
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    WS_ALLOWED_ORIGINS: ORIGIN,
    HTTP_RATE_LIMIT_PER_MINUTE: "100000",
  });

  const clock = new ManualClock(new Date("2026-09-29T10:00:00.000Z"));
  const raw = new Redis(valkey.url);

  async function boot(): Promise<Running> {
    const { AppModule } = await import("../app.module.js");
    const scheduler = new ManualScheduler(clock);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(SCHEDULER)
      .useValue(scheduler)
      .overrideProvider(RANDOM)
      .useValue(new SeededRandom(options.seed ?? 20260929))
      .overrideProvider(AccessTokenVerifier)
      .useValue(verifier)
      .compile();
    const app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(),
    );
    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    return { app, scheduler, port };
  }

  let running = await boot();
  // Concurrent players share one manual clock: advances run one at a time.
  let advancing: Promise<unknown> = Promise.resolve();

  const tokenFor = (userId: string, roles: string[] = []) =>
    new SignJWT({ sid: randomUUID(), roles, av: 0 })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  const http = () => request(running.app.getHttpServer());
  const auth = async (userId: string, roles: string[] = []) => ({
    authorization: `Bearer ${await tokenFor(userId, roles)}`,
  });

  async function ticketFor(userId: string): Promise<string> {
    const response = await http()
      .post("/v1/ws-tickets")
      .set(await auth(userId))
      .expect(201);
    return response.body.ticket as string;
  }

  function socketUrl(ticket: string | null) {
    return `ws://127.0.0.1:${running.port}/ws${ticket === null ? "" : `?ticket=${encodeURIComponent(ticket)}`}`;
  }

  /** Opens a game socket for the user and waits for `session.ready`. */
  async function connect(userId: string = randomUUID()) {
    const socket = await TestSocket.open(
      socketUrl(await ticketFor(userId)),
      ORIGIN,
    );
    const ready = await socket.next("session.ready");
    return Object.assign(socket, { userId, ready: ready.payload });
  }

  /** Publishes an event as its producer would (through RabbitMQ). */
  async function publish(event: AnyEvent) {
    await running.app.get(Messaging).publish(`${event.producer}.events`, event);
  }

  /** Collects events of a type from the battleship exchange. */
  async function captureEvents(type: string) {
    const events: AnyEvent[] = [];
    await running.app
      .get(Messaging)
      .subscribe(
        defineQueue("admin", `test-${randomUUID()}`, [
          { producer: "battleship", types: [type] },
        ]),
        async (event) => {
          events.push(event);
        },
      );
    return events;
  }

  let grantVersion = 0;
  function grantEvent(input: {
    userId: string;
    feature?: string;
    grantId?: string;
    version?: number;
    state?: "active" | "revoked" | "expired";
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
        service: input.service ?? "battleship",
        feature: input.feature ?? battleshipFeatures.premium,
        sourceType: "purchase",
        sourceId: randomUUID(),
        state: input.state ?? "active",
        validFrom: new Date(clock.now().getTime() - 60_000).toISOString(),
        validUntil: input.validUntil ?? null,
      },
    });
  }

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

  return {
    clock,
    /** Raw Valkey client without the service prefix, for inspection. */
    valkey: raw,
    get app() {
      return running.app;
    },
    get scheduler() {
      return running.scheduler;
    },
    get db() {
      return running.app.get<BattleshipDatabase>(DATABASE).db;
    },
    get<T>(type: abstract new (...args: never[]) => T): T {
      return running.app.get(type as never) as T;
    },
    http,
    auth,
    tokenFor,
    ticketFor,
    socketUrl,
    connect,
    publish,
    captureEvents,
    grantEvent,
    statusEvent,
    /** Advances the clock, running every timer that falls due. */
    advance(ms: number): Promise<void> {
      const step = advancing.then(() => running.scheduler.advance(ms));
      advancing = step.catch(() => undefined);
      return step;
    },
    /** A new app instance over the same database, Valkey and RabbitMQ. */
    async restart() {
      await running.app.close();
      running = await boot();
    },
    async close() {
      await running.app.close();
      await raw.quit();
      await Promise.all([pg.stop(), valkey.stop(), rabbit.stop()]);
    },
  };
}

export { cellsOf, fleets, waterOf } from "./fixtures.js";
