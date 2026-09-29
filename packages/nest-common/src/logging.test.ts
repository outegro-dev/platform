import { Writable } from "node:stream";
import {
  Body,
  Controller,
  Module,
  Logger as NestLogger,
  Post,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { runWithCorrelation } from "@outegro/db";
import { Logger } from "nestjs-pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureApp } from "./bootstrap.js";
import { createLoggerModule } from "./logging.js";

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
}

let app: NestExpressApplication;

beforeAll(async () => {
  @Module({
    imports: [
      createLoggerModule({ service: "test", level: "info", destination }),
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
