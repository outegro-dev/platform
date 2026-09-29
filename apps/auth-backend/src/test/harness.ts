import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
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
import { Redis } from "ioredis";
import request from "supertest";
import {
  type GoogleProfile,
  GoogleRejected,
  GoogleUnavailable,
} from "../identities/google.provider.js";
import type { CodeMessage, DeliveryStatus } from "../login/code-delivery.js";

/** Captures login codes instead of emailing them. */
export class FakeCodeDelivery {
  messages: CodeMessage[] = [];
  status: DeliveryStatus = "accepted";
  async deliver(message: CodeMessage) {
    this.messages.push(message);
    return this.status;
  }
  codeFor(email: string) {
    const message = [...this.messages]
      .reverse()
      .find((m) => m.email === email.toLowerCase());
    if (!message) throw new Error(`no code for ${email}`);
    return message;
  }
}

/** Stands in for Google: each registered code verifies once to its account. */
export class FakeGoogle {
  readonly enabled = true;
  readonly clientId = "google-client.test";
  readonly redirectUri = "http://localhost:3002/login/google/callback";
  unavailable = false;
  private readonly codes = new Map<string, GoogleProfile>();

  code(profile: GoogleProfile) {
    const code = `google-code-${randomBytes(12).toString("hex")}`;
    this.codes.set(code, profile);
    return code;
  }

  async verify({ code }: { code: string }) {
    if (this.unavailable) throw new GoogleUnavailable("google down");
    const profile = this.codes.get(code);
    if (!profile) throw new GoogleRejected("invalid_grant");
    this.codes.delete(code);
    return profile;
  }
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** Real PostgreSQL, Valkey and RabbitMQ; controllable clock; captured codes. */
export async function startHarness() {
  const schema = await import("../db/schema.js");
  const [pg, valkey, rabbit] = (await Promise.all([
    startPostgres({ ...schema }),
    startValkey(),
    startRabbit(),
  ])) as [TestPostgres, TestService, TestService];

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4999",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    VALKEY_URL: valkey.url,
    RABBITMQ_URL: rabbit.url,
    AUTH_ISSUER: "http://identity.test",
    AUTH_AUDIENCE: "outegro",
    JWT_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    LOGIN_CODE_PEPPER: randomBytes(32).toString("hex"),
    NOTIFICATIONS_INTERNAL_URL: "http://notifications.test",
    INTERNAL_API_TOKEN: randomBytes(32).toString("hex"),
    REFRESH_GRACE_MS: "1000",
    OAUTH_CLIENTS: JSON.stringify([
      {
        id: "pay-web",
        name: "Payments",
        redirectUris: ["https://pay.outegro.dev/auth/callback"],
      },
      {
        id: "admin-web",
        name: "Admin",
        redirectUris: ["https://admin.outegro.dev/auth/callback"],
      },
    ]),
  });

  const { AppModule } = await import("../app.module.js");
  const { CODE_DELIVERY } = await import("../login/code-delivery.js");
  const { GOOGLE_PROVIDER } = await import("../identities/google.provider.js");
  const clock = new ManualClock(new Date());
  const delivery = new FakeCodeDelivery();
  const google = new FakeGoogle();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(CODE_DELIVERY)
    .useValue(delivery)
    .overrideProvider(GOOGLE_PROVIDER)
    .useValue(google)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
    {
      excludeFromPrefix: [".well-known/jwks.json"],
    },
  );
  await app.init();
  const valkeyClient = new Redis(valkey.url);
  const http = () => request(app.getHttpServer());

  /** Full email-code sign-in; returns the token pair and user. */
  async function signIn(email: string, locale: "en" | "ru" = "en") {
    const challenge = await http()
      .post("/v1/login/challenges")
      .send({ email, locale })
      .expect(201);
    const { code } = delivery.codeFor(email);
    const verified = await http()
      .post("/v1/login/challenges/verify")
      .send({ challengeId: challenge.body.challengeId, code })
      .expect(200);
    return verified.body as {
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      user: { id: string; email: string };
    };
  }

  /** Clears business rate limits (resend cooldown etc.) but keeps sessions. */
  async function resetLimits() {
    await valkeyClient.eval(
      "for _, k in ipairs(redis.call('KEYS', 'bl:*')) do redis.call('DEL', k) end",
      0,
    );
  }

  return {
    app,
    resetLimits,
    moduleRef,
    clock,
    delivery,
    google,
    http,
    signIn,
    valkey: valkeyClient,
    auth: (token: string) => ({ authorization: `Bearer ${token}` }),
    /** What Prometheus would scrape now. */
    scrape: () => app.get(Metrics).scrape(),
    /** Sum of the series of `name` with these labels in a fresh scrape. */
    async metric(name: string, labels: Record<string, string> = {}) {
      return metricValue(await app.get(Metrics).scrape(), name, labels);
    },
    async close() {
      await app.close();
      await valkeyClient.quit();
      await Promise.all([pg.stop(), valkey.stop(), rabbit.stop()]);
    },
  };
}

let seq = 0;
export const uniqueEmail = (prefix = "user") =>
  `${prefix}.${Date.now()}.${seq++}@example.test`;
