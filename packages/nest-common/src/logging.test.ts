import { Writable } from "node:stream";
import {
  Body,
  Controller,
  Get,
  Module,
  Logger as NestLogger,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { runWithCorrelation } from "@outegro/db";
import { Logger } from "nestjs-pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureApp } from "./bootstrap.js";
import { AppError } from "./errors.js";
import { HealthModule, HealthRegistry } from "./health.js";
import { createLoggerModule } from "./logging.js";
import { Metrics, MetricsModule } from "./metrics.js";
import { metricValue } from "./testing.js";

type Line = Record<string, unknown>;
const lines: Line[] = [];
const destination = new Writable({
  write(chunk, _encoding, done) {
    for (const line of String(chunk).split("\n"))
      if (line) lines.push(JSON.parse(line) as Line);
    done();
  },
});

@Controller("sessions")
class SessionsController {
  private readonly logger = new NestLogger("Sessions");

  @Post()
  create(@Body() _body: unknown) {
    this.logger.log({ step: "code" }, "Code checked");
    return { ok: true };
  }

  @Get("unavailable")
  unavailable() {
    throw new AppError("DEPENDENCY_UNAVAILABLE");
  }

  @Get("maintenance")
  maintenance() {
    throw new ServiceUnavailableException();
  }

  @Get("boom")
  boom() {
    throw new Error("boom");
  }
}

let app: NestExpressApplication;
let failing = false;

beforeAll(async () => {
  @Module({
    imports: [
      createLoggerModule({ service: "test", level: "info", destination }),
      HealthModule,
      MetricsModule.forRootAsync({
        useFactory: () => ({ service: "test", port: 0 }),
      }),
    ],
    controllers: [SessionsController],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestModule],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useLogger(app.get(Logger));
  configureApp(app);
  app.get(HealthRegistry).register("postgres", async () => {
    if (failing) throw new Error("connection refused");
  });
  await app.init();
});
afterAll(async () => {
  await app?.close();
});

const waitFor = async (predicate: () => boolean) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("log correlation", () => {
  it("every line of a request carries its request id, none carries credentials or codes", async () => {
    await request(app.getHttpServer())
      .post("/v1/sessions")
      .set("x-request-id", "req-log-00000001")
      .set("authorization", "Bearer top-secret-token")
      .send({ email: "someone@example.test", code: "314159" })
      .expect(201);
    await waitFor(() =>
      lines.some(
        (line) =>
          line.requestId === "req-log-00000001" &&
          line.message === "request completed",
      ),
    );
    const mine = lines.filter((line) => line.requestId === "req-log-00000001");
    expect(mine.map((line) => line.message)).toEqual(
      expect.arrayContaining(["Code checked", "request completed"]),
    );
    expect(mine.find((line) => line.message === "Code checked")).toMatchObject({
      correlationId: "req-log-00000001",
      service: "test",
    });
    const text = JSON.stringify(lines);
    expect(text).not.toContain("top-secret-token");
    expect(text).not.toContain("314159");
    expect(text).not.toContain("someone@example.test");
  });

  it("a line written while handling an event carries the event's correlation id", async () => {
    runWithCorrelation(
      { correlationId: "corr-log-0001", causationId: "event-1" },
      () => new NestLogger("Consumer").log("Grant applied"),
    );
    await waitFor(() => lines.some((line) => line.message === "Grant applied"));
    expect(
      lines.find((line) => line.message === "Grant applied"),
    ).toMatchObject({ correlationId: "corr-log-0001" });
    new NestLogger("Worker").log("Pass done");
    await waitFor(() => lines.some((line) => line.message === "Pass done"));
    expect(
      lines.find((line) => line.message === "Pass done"),
    ).not.toHaveProperty("correlationId");
  });
});

/** pino's numeric levels. */
const INFO = 30;
const WARN = 40;
const ERROR = 50;

describe("log levels", () => {
  const http = () => request(app.getHttpServer());
  /** Lines written while `work` runs: the error filter logs before it answers. */
  const linesOf = async (work: () => PromiseLike<unknown>) => {
    const from = lines.length;
    await work();
    return lines.slice(from);
  };
  const errors = (written: Line[]) =>
    written.filter((line) => Number(line.level) >= ERROR);

  it("an expected 503 is a warning and an unexpected failure an error; answers and metrics stay", async () => {
    for (const path of [
      "/v1/sessions/unavailable",
      "/v1/sessions/maintenance",
    ]) {
      const written = await linesOf(() => http().get(path).expect(503));
      expect(
        written.find((line) => line.message === "Request failed"),
      ).toMatchObject({ level: WARN, context: "ErrorFilter" });
      expect(errors(written)).toEqual([]);
    }
    const failed = await linesOf(() =>
      http().get("/v1/sessions/boom").expect(500),
    );
    expect(
      failed.find((line) => line.message === "Request failed"),
    ).toMatchObject({ level: ERROR, context: "ErrorFilter" });

    const scrape = await app.get(Metrics).scrape();
    for (const route of [
      "/v1/sessions/unavailable",
      "/v1/sessions/maintenance",
      "/v1/sessions/boom",
    ])
      expect(
        metricValue(scrape, "http_server_requests_total", {
          route,
          status_class: "5xx",
        }),
      ).toBe(1);
  });

  it("a dependency down on readiness is a warning", async () => {
    failing = true;
    const written = await linesOf(() => http().get("/health/deep").expect(503));
    failing = false;
    const failure = written.find((line) =>
      String(line.message).startsWith("Health Check has failed!"),
    );
    expect(failure).toMatchObject({ level: WARN, context: "HealthCheck" });
    expect(failure?.message).toContain("connection refused");
    expect(errors(written)).toEqual([]);
  });

  it("a body over the limit is the client's mistake, not an error", async () => {
    const written = await linesOf(() =>
      http()
        .post("/v1/sessions")
        .set("x-request-id", "req-log-00000002")
        .send({ padding: "x".repeat(200_000) })
        .expect(413),
    );
    expect(errors(written)).toEqual([]);
    // The access log never sees it, so the filter notes it instead.
    expect(
      written.find((line) => line.message === "Request body refused"),
    ).toMatchObject({
      level: INFO,
      requestId: "req-log-00000002",
      method: "POST",
      path: "/v1/sessions",
      type: "entity.too.large",
    });
  });
});
