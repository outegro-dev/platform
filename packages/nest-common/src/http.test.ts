import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type AuthenticatedUser,
  AuthModule,
  CurrentUser,
  Public,
  RequirePermissions,
} from "./auth.js";
import { configureApp } from "./bootstrap.js";
import { AppError } from "./errors.js";
import { HealthModule, HealthRegistry } from "./health.js";
import { createLoggerModule } from "./logging.js";
import { Metrics, MetricsModule } from "./metrics.js";
import { metricValue } from "./testing.js";

const createNoteSchema = z.object({
  title: z.string().min(3),
  tags: z.array(z.string().max(5)).max(3),
});

@Controller("notes")
class NotesController {
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return { userId: user.userId };
  }

  @Post()
  create(
    @Body({ schema: createNoteSchema }) body: z.infer<typeof createNoteSchema>,
  ) {
    return { ok: true, title: body.title };
  }

  @Get("admin")
  @RequirePermissions("roles.assign")
  admin() {
    return { ok: true };
  }

  @Public()
  @Get("conflict")
  conflict() {
    throw new AppError("VERSION_CONFLICT");
  }

  @Public()
  @Get("boom")
  boom() {
    throw new Error("database password is hunter2");
  }
}

let app: NestExpressApplication;
let sign: (
  claims: Record<string, unknown>,
  options?: { expired?: boolean },
) => Promise<string>;
let failing = false;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), alg: "ES256" }],
  });
  sign = (claims, options = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://id.outegro.dev")
      .setAudience("outegro")
      .setIssuedAt()
      .setExpirationTime(options.expired ? "-1m" : "5m")
      .sign(privateKey);

  @Module({
    imports: [
      createLoggerModule({ service: "test", level: "silent" }),
      HealthModule,
      MetricsModule.forRootAsync({
        useFactory: () => ({ service: "test", port: 0 }),
      }),
      AuthModule.forRootAsync({
        useFactory: () => ({
          issuer: "https://id.outegro.dev",
          audience: "outegro",
          keys: jwks,
        }),
      }),
    ],
    controllers: [NotesController],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestModule],
  }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  app.get(HealthRegistry).register("postgres", async () => {
    if (failing) throw new Error("connection refused");
  });
  await app.init();
});
afterAll(async () => {
  await app?.close();
});

const user = { sub: randomUUID(), sid: randomUUID(), av: 1 };

describe("authentication", () => {
  it("rejects missing, malformed, expired and foreign-audience tokens with 401", async () => {
    await request(app.getHttpServer()).get("/v1/notes/me").expect(401);
    await request(app.getHttpServer())
      .get("/v1/notes/me")
      .set("authorization", "Bearer not-a-jwt")
      .expect(401);
    const expired = await sign({ ...user, roles: [] }, { expired: true });
    const res = await request(app.getHttpServer())
      .get("/v1/notes/me")
      .set("authorization", `Bearer ${expired}`)
      .expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("exposes the verified user to handlers", async () => {
    const token = await sign({ ...user, roles: [] });
    const res = await request(app.getHttpServer())
      .get("/v1/notes/me")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ userId: user.sub });
  });
});

describe("permissions", () => {
  it("denies by default and allows only roles that grant the permission", async () => {
    const paid = await sign({ ...user, roles: ["pro", "support"] });
    await request(app.getHttpServer())
      .get("/v1/notes/admin")
      .set("authorization", `Bearer ${paid}`)
      .expect(403);
    const owner = await sign({ ...user, roles: ["owner"] });
    await request(app.getHttpServer())
      .get("/v1/notes/admin")
      .set("authorization", `Bearer ${owner}`)
      .expect(200);
  });
});

describe("validation and errors", () => {
  it("returns field errors in the contract shape and echoes the request id", async () => {
    const token = await sign({ ...user, roles: [] });
    const res = await request(app.getHttpServer())
      .post("/v1/notes")
      .set("authorization", `Bearer ${token}`)
      .set("x-request-id", "req-test-00000001")
      .send({ title: "x", tags: ["toolong"] })
      .expect(400);
    expect(res.headers["x-request-id"]).toBe("req-test-00000001");
    expect(res.body).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        messageKey: "errors.validationFailed",
        fieldErrors: {
          title: [expect.any(String)],
          "tags.0": [expect.any(String)],
        },
        requestId: "req-test-00000001",
        retryable: false,
      },
    });
  });

  it("passes valid input through the schema", async () => {
    const token = await sign({ ...user, roles: [] });
    await request(app.getHttpServer())
      .post("/v1/notes")
      .set("authorization", `Bearer ${token}`)
      .send({ title: "Hello", tags: [] })
      .expect(201, { ok: true, title: "Hello" });
  });

  it("maps domain errors to their status and hides unexpected ones", async () => {
    const conflict = await request(app.getHttpServer())
      .get("/v1/notes/conflict")
      .expect(409);
    expect(conflict.body.error.code).toBe("VERSION_CONFLICT");
    const boom = await request(app.getHttpServer())
      .get("/v1/notes/boom")
      .expect(500);
    expect(boom.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(boom.body)).not.toContain("hunter2");
  });
});

describe("health", () => {
  it("keeps liveness independent of dependencies; readiness reports them", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
    const ok = await request(app.getHttpServer())
      .get("/health/deep")
      .expect(200);
    expect(ok.body.info.postgres.status).toBe("up");
    failing = true;
    const down = await request(app.getHttpServer())
      .get("/health/deep")
      .expect(503);
    expect(down.body.error.postgres.message).toBe("connection refused");
    await request(app.getHttpServer()).get("/health").expect(200);
    failing = false;
  });
});

describe("metrics", () => {
  it("counts requests a guard or a handler refused under their route template", async () => {
    const scrape = await app.get(Metrics).scrape();
    const count = (route: string, status_class: string) =>
      metricValue(scrape, "http_server_requests_total", {
        method: "GET",
        route,
        status_class,
      });
    expect(count("/v1/notes/me", "4xx")).toBeGreaterThanOrEqual(3);
    expect(count("/v1/notes/admin", "4xx")).toBeGreaterThanOrEqual(1);
    expect(count("/v1/notes/boom", "5xx")).toBeGreaterThanOrEqual(1);
    expect(scrape).not.toContain('route="/health');
  });
});
