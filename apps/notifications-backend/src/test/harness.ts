import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  createEvent,
  identityUserContactChanged,
  identityUserCreated,
  notificationRequested,
} from "@outegro/contracts";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import { CLOCK, configureApp, ManualClock } from "@outegro/nest-common";
import {
  startRabbit,
  startValkey,
  type TestService,
} from "@outegro/nest-common/testing";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import type { EmailMessage } from "../channels/providers.js";

/** Records sends; `fail` makes the next sends throw the given error. */
export class FakeEmail {
  sent: EmailMessage[] = [];
  attempts: EmailMessage[] = [];
  fail: Error | null = null;
  async send(message: EmailMessage) {
    this.attempts.push(message);
    if (this.fail) throw this.fail;
    this.sent.push(message);
    return { id: `email-${this.sent.length}` };
  }
}
export class FakeTelegram {
  sent: { chatId: string; text: string }[] = [];
  async send(chatId: string, text: string) {
    this.sent.push({ chatId, text });
    return { id: String(this.sent.length) };
  }
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

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

  const internalToken = randomBytes(32).toString("hex");
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4998",
    LOG_LEVEL: "error",
    DATABASE_URL: pg.url,
    VALKEY_URL: valkey.url,
    RABBITMQ_URL: rabbit.url,
    AUTH_JWKS_URL: `http://127.0.0.1:${jwksPort}/jwks.json`,
    AUTH_ISSUER: "http://identity.test",
    AUTH_AUDIENCE: "outegro",
    INTERNAL_API_TOKEN: internalToken,
    PUBLIC_WEB_URL: "https://outegro.dev",
    ACCOUNT_URL: "https://id.outegro.dev",
  });

  const { AppModule } = await import("../app.module.js");
  const { EMAIL_PROVIDER, TELEGRAM_PROVIDER } = await import(
    "../channels/providers.js"
  );
  const clock = new ManualClock(new Date());
  const email = new FakeEmail();
  const telegram = new FakeTelegram();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(email)
    .overrideProvider(TELEGRAM_PROVIDER)
    .useValue(telegram)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
  );
  await app.init();

  const tokenFor = (userId: string) =>
    new SignJWT({ sid: randomUUID(), roles: [], av: 0 })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setSubject(userId)
      .setIssuer("http://identity.test")
      .setAudience("outegro")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  return {
    app,
    moduleRef,
    clock,
    email,
    telegram,
    internalToken,
    rabbitUrl: rabbit.url,
    http: () => request(app.getHttpServer()),
    tokenFor,
    async close() {
      await app.close();
      jwksServer.close();
      await Promise.all([pg.stop(), valkey.stop(), rabbit.stop()]);
    },
  };
}

/** Identity events for a user with a verified email. */
export function userEvents(
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

export function intentEvent(input: {
  userId: string;
  templateKey: string;
  category: "security" | "billing" | "service" | "auth";
  data?: Record<string, string | number | boolean | null>;
  sourceEventId?: string;
  channels?: ("email" | "telegram" | "inbox")[];
}) {
  return createEvent(notificationRequested, {
    producer: "identity",
    aggregateId: input.userId,
    aggregateVersion: 1,
    payload: {
      sourceEventId: input.sourceEventId ?? randomUUID(),
      templateKey: input.templateKey,
      category: input.category,
      recipient: { userId: input.userId },
      ...(input.channels ? { channels: input.channels } : {}),
      data: input.data ?? {},
    },
  });
}
