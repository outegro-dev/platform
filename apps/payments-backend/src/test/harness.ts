import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  createEvent,
  identityUserContactChanged,
  identityUserCreated,
} from "@outegro/contracts";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import {
  CLOCK,
  configureApp,
  ManualClock,
  Metrics,
} from "@outegro/nest-common";
import {
  metricValue,
  startRabbit,
  startValkey,
  type TestService,
} from "@outegro/nest-common/testing";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { FakeLava } from "./fake-lava.js";

export type Harness = Awaited<ReturnType<typeof startHarness>>;

export type IdentityUser = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  locale: "en" | "ru";
  status: "active" | "suspended" | "deleted";
  accessVersion: number;
};

/** Real PostgreSQL, Valkey and RabbitMQ; a manual clock; a fake Lava. */
export async function startHarness() {
  const schema = await import("../db/schema.js");
  const [pg, valkey, rabbit] = (await Promise.all([
    startPostgres({ ...schema }),
    startValkey(),
    startRabbit(),
  ])) as [TestPostgres, TestService, TestService];

  // A tiny JWKS endpoint standing in for Identity.
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" };
  const jwksServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) =>
    jwksServer.listen(0, "127.0.0.1", resolve),
  );
  const jwksPort = (jwksServer.address() as AddressInfo).port;

  // Identity's internal lookup, for buyers who signed up before payments existed.
  const internalToken = randomBytes(32).toString("hex");
  const identityUsers = new Map<string, IdentityUser>();
  const identityServer = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const allowed =
        req.method === "POST" &&
        req.url === "/v1/internal/users/lookup" &&
        req.headers.authorization === `Bearer ${internalToken}`;
      const user = allowed
        ? identityUsers.get(JSON.parse(body || "{}").userId)
        : undefined;
      res.statusCode = !allowed ? 401 : user ? 200 : 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(user ?? { error: { code: "NOT_FOUND" } }));
    });
  });
  await new Promise<void>((resolve) =>
    identityServer.listen(0, "127.0.0.1", resolve),
  );
  const identityPort = (identityServer.address() as AddressInfo).port;

  const webhookSecret = randomBytes(32).toString("hex");
  Object.assign(process.env, {
    AUTH_INTERNAL_URL: `http://127.0.0.1:${identityPort}`,
    INTERNAL_API_TOKEN: internalToken,
    NODE_ENV: "test",
    PORT: "4997",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    VALKEY_URL: valkey.url,
    RABBITMQ_URL: rabbit.url,
    AUTH_JWKS_URL: `http://127.0.0.1:${jwksPort}/jwks.json`,
    AUTH_ISSUER: "http://identity.test",
    AUTH_AUDIENCE: "outegro",
    CHECKOUT_ENABLED: "true",
    PAY_WEB_URL: "https://pay.outegro.dev",
    CHECKOUT_RETURN_ORIGINS: "https://battleship.outegro.dev",
    // The real adapter is replaced below; this host never resolves.
    LAVA_API_URL: "https://gate.lava.invalid",
    LAVA_API_KEY: "fake-key-never-sent",
    LAVA_WEBHOOK_SECRET: webhookSecret,
  });

  const { AppModule } = await import("../app.module.js");
  const { PAYMENT_PROVIDER } = await import("../lava/provider.js");
  const { WEBHOOK_ROUTES } = await import("../lava/routes.js");
  const clock = new ManualClock(new Date());
  const lava = new FakeLava(clock);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(lava)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
    {
      excludeFromPrefix: WEBHOOK_ROUTES,
    },
  );
  // Listening once lets supertest reuse the server for parallel requests.
  await app.listen(0, "127.0.0.1");

  const tokenFor = (userId: string, roles: string[] = [], accessVersion = 0) =>
    new SignJWT({ sid: randomUUID(), roles, av: accessVersion })
      .setProtectedHeader({ alg: "ES256", kid: "test", typ: "at+jwt" })
      .setSubject(userId)
      .setIssuer("http://identity.test")
      .setAudience("outegro")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  return {
    app,
    clock,
    lava,
    webhookSecret,
    identityUsers,
    rabbitUrl: rabbit.url,
    http: () => request(app.getHttpServer()),
    tokenFor,
    /** What Prometheus would scrape now. */
    scrape: () => app.get(Metrics).scrape(),
    /** Sum of the series of `name` with these labels in a fresh scrape. */
    async metric(name: string, labels: Record<string, string> = {}) {
      return metricValue(await app.get(Metrics).scrape(), name, labels);
    },
    async close() {
      await app.close();
      jwksServer.close();
      identityServer.close();
      await Promise.all([pg.stop(), valkey.stop(), rabbit.stop()]);
    },
  };
}

/** Identity events for a user with a verified email. */
export function customerEvents(
  userId: string,
  email: string,
  locale: "en" | "ru" = "en",
) {
  return [
    createEvent(identityUserCreated, {
      aggregateId: userId,
      aggregateVersion: 1,
      payload: { userId, locale, status: "active" },
    }),
    createEvent(identityUserContactChanged, {
      aggregateId: userId,
      aggregateVersion: 1,
      payload: { userId, email, emailVerified: true },
    }),
  ];
}
