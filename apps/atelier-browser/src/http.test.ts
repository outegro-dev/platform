import { randomBytes } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { browserApplyResponseSchema } from "@outegro/contracts/atelier";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type FixtureServer,
  startFixtureServer,
} from "./test/fixture-server.js";
import { applyRequest, dummyPdf } from "./test/request.js";

const token = randomBytes(32).toString("hex");
let app: NestExpressApplication;
let fixtures: FixtureServer;

beforeAll(async () => {
  fixtures = await startFixtureServer();
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "4998",
    METRICS_PORT: "0",
    LOG_LEVEL: "error",
    ATELIER_BROWSER_TOKEN: token,
    BROWSER_CONCURRENCY: "1",
  });
  const { AppModule } = await import("./app.module.js");
  const { APPLY_OVERRIDES } = await import("./apply/apply.service.js");
  const { setupApp } = await import("./app.setup.js");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APPLY_OVERRIDES)
    // Local fixtures only; any other host is aborted inside the browser.
    .useValue({ trustUrl: true, allowHosts: ["127.0.0.1"] })
    .compile();
  app = setupApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe("HTTP API", () => {
  it("GET /health answers without a token", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
  });

  it("POST /v1/apply needs the service token", async () => {
    const body = applyRequest({
      ats: "workable",
      applyUrl: fixtures.url("/login"),
    });
    const missing = await request(app.getHttpServer())
      .post("/v1/apply")
      .send(body);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("UNAUTHENTICATED");
    const wrong = await request(app.getHttpServer())
      .post("/v1/apply")
      .set("authorization", `Bearer ${"x".repeat(64)}`)
      .send(body);
    expect(wrong.status).toBe(401);
  });

  it("rejects a body outside the contract", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/apply")
      .set("authorization", `Bearer ${token}`)
      .send({ mode: "apply", ats: "taleo", applyUrl: "not a url" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(
      expect.arrayContaining(["mode", "ats", "applyUrl", "fields", "cv"]),
    );
  });

  it("prepares a form with a multi-megabyte CV and answers in the contract shape", async () => {
    // ~2 MB of PDF: well over Express's default 100 kB JSON limit.
    const big = Buffer.concat([dummyPdf(), Buffer.alloc(1_500_000, 0x20)]);
    const body = applyRequest({
      ats: "workable",
      applyUrl: fixtures.url("/workable/acme/j/ABC123/apply/"),
      cv: { fileName: "Alex_Example_CV.pdf", base64: big.toString("base64") },
    });
    const res = await request(app.getHttpServer())
      .post("/v1/apply")
      .set("authorization", `Bearer ${token}`)
      .send(body)
      .expect(200);
    const parsed = browserApplyResponseSchema.parse(res.body);
    expect(parsed.status).toBe("prepared");
    expect(parsed.filled).toContainEqual({
      label: "Resume",
      value: "Alex_Example_CV.pdf",
    });
    expect(parsed.unanswered.some((field) => field.required)).toBe(true);
    expect(parsed.screenshotBase64).toMatch(/^\/9j\//);
  });

  it("reports a login wall as needs_human", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/apply")
      .set("authorization", `Bearer ${token}`)
      .send(applyRequest({ ats: "workable", applyUrl: fixtures.url("/login") }))
      .expect(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: "needs_human",
        reason: "login_required",
      }),
    );
  });
});
