import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import { CLOCK, configureApp, ManualClock } from "@outegro/nest-common";
import {
  startRabbit,
  startValkey,
  type TestService,
} from "@outegro/nest-common/testing";
import { Redis } from "ioredis";
import request from "supertest";
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
  });

  const { AppModule } = await import("../app.module.js");
  const { CODE_DELIVERY } = await import("../login/code-delivery.js");
  const clock = new ManualClock(new Date());
  const delivery = new FakeCodeDelivery();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(CODE_DELIVERY)
    .useValue(delivery)
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
    http,
    signIn,
    valkey: valkeyClient,
    auth: (token: string) => ({ authorization: `Bearer ${token}` }),
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
