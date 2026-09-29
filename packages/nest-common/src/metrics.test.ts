import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Controller, Get, Module, Param } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { configureApp } from "./bootstrap.js";
import { metricsEnvSchema } from "./config.js";
import { HealthModule } from "./health.js";
import { createLoggerModule } from "./logging.js";
import { Metrics, MetricsModule, MetricsServer } from "./metrics.js";
import { idLikeLabelValues, metricValue } from "./testing.js";

@Controller("things")
class ThingsController {
  @Get(":id")
  get(@Param("id") id: string) {
    return { id };
  }
}

/** A port nothing listens on right now. */
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function start(metricsPort: number) {
  @Module({
    imports: [
      createLoggerModule({ service: "things", level: "silent" }),
      HealthModule,
      MetricsModule.forRootAsync({
        useFactory: () => ({ service: "things", port: metricsPort }),
      }),
    ],
    controllers: [ThingsController],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestModule],
  }).compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>(),
  );
  await app.listen(0, "127.0.0.1");
  return app;
}

describe("metrics listener", () => {
  it("serves GET /metrics on its own port and never on the application port", async () => {
    const port = await freePort();
    const app = await start(port);
    try {
      expect(app.get(MetricsServer).port).toBe(port);
      const scrape = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(scrape.status).toBe(200);
      expect(scrape.headers.get("content-type")).toBe(
        "text/plain; version=0.0.4; charset=utf-8",
      );
      const text = await scrape.text();
      expect(text).toContain("# TYPE process_cpu_user_seconds_total counter");
      expect(text).toContain("# TYPE nodejs_eventloop_lag_seconds gauge");
      expect(text).toContain('service="things"');
      await request(app.getHttpServer()).get("/metrics").expect(404);
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
      const post = await fetch(`http://127.0.0.1:${port}/metrics`, {
        method: "POST",
      });
      expect(post.status).toBe(405);
    } finally {
      await app.close();
    }
    await expect(fetch(`http://127.0.0.1:${port}/metrics`)).rejects.toThrow();
  });

  it("METRICS_PORT=0 turns the listener off; the default is 9464", async () => {
    const app = await start(0);
    try {
      expect(app.get(MetricsServer).port).toBeNull();
      expect(await app.get(Metrics).scrape()).toContain(
        "# TYPE http_server_requests_total counter",
      );
    } finally {
      await app.close();
    }
    expect(metricsEnvSchema.parse({}).METRICS_PORT).toBe(9464);
    expect(metricsEnvSchema.parse({ METRICS_PORT: "0" }).METRICS_PORT).toBe(0);
    expect(metricsEnvSchema.safeParse({ METRICS_PORT: "70000" }).success).toBe(
      false,
    );
  });
});

describe("HTTP metrics", () => {
  it("count by route template, unknown paths as unmatched, without health probes", async () => {
    const app = await start(0);
    try {
      const http = () => request(app.getHttpServer());
      const id = randomUUID();
      await http().get(`/v1/things/${id}`).expect(200);
      await http().get(`/v1/things/${randomUUID()}`).expect(200);
      await http().get(`/v1/nothing/${id}`).expect(404);
      await http().get("/wp-login.php").expect(404);
      await http().get("/health").expect(200);
      await http().get("/health/deep").expect(200);
      const scrape = await app.get(Metrics).scrape();
      const count = (labels: Record<string, string>) =>
        metricValue(scrape, "http_server_requests_total", labels);
      expect(
        count({ method: "GET", route: "/v1/things/:id", status_class: "2xx" }),
      ).toBe(2);
      expect(count({ route: "unmatched", status_class: "4xx" })).toBe(2);
      expect(count({})).toBe(4);
      expect(
        metricValue(scrape, "http_server_request_duration_seconds_count", {
          route: "/v1/things/:id",
        }),
      ).toBe(2);
      expect(
        metricValue(scrape, "http_server_request_duration_seconds_bucket", {
          route: "/v1/things/:id",
          le: "10",
        }),
      ).toBe(2);
      expect(scrape).not.toContain("/health");
      expect(scrape).not.toContain(id);
      expect(idLikeLabelValues(scrape)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("a failing store read makes its gauges unknown without failing the scrape", async () => {
    const app = await start(0);
    try {
      const metrics = app.get(Metrics);
      const backlog = metrics.gauge({ name: "test_backlog", help: "Test." });
      const byChannel = metrics.gauge({
        name: "test_queued",
        help: "Test.",
        labelNames: ["channel"],
      });
      let down = false;
      metrics.readOnScrape("test", [backlog, byChannel], async () => {
        if (down) throw new Error("connection refused");
        backlog.set(3);
        byChannel.set({ channel: "email" }, 2);
      });
      const healthy = await metrics.scrape();
      expect(metricValue(healthy, "test_backlog")).toBe(3);
      expect(metricValue(healthy, "test_queued", { channel: "email" })).toBe(2);
      down = true;
      const failed = await metrics.scrape();
      expect(metricValue(failed, "test_backlog")).toBeNaN();
      expect(failed).not.toContain("test_queued{");
      expect(
        metricValue(failed, "metrics_read_errors_total", { reader: "test" }),
      ).toBe(1);
      expect(failed).toContain("process_cpu_user_seconds_total");
    } finally {
      await app.close();
    }
  });
});
