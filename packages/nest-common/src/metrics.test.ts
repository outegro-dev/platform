import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Controller, Get, Module, Param } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { createDatabase } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});

describe("store reads on scrape", () => {
  let pg: TestPostgres;
  let database: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    pg = await startPostgres();
    database = createDatabase({ url: pg.url });
  });
  afterAll(async () => {
    await database?.close();
    await pg?.stop();
  });

  /** Statements of other sessions still running now. */
  const running = async (text: string) =>
    (
      await database.db.execute<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where state = 'active' and pid <> pg_backend_pid()
            and query like '%${text}%'`,
      )
    ).rows[0]?.n;

  it("a failing store read makes its gauges unknown without failing the scrape", async () => {
    const metrics = new Metrics({ service: "test", port: 0 });
    const backlog = metrics.gauge({ name: "test_backlog", help: "Test." });
    const byChannel = metrics.gauge({
      name: "test_queued",
      help: "Test.",
      labelNames: ["channel"],
    });
    let down = false;
    metrics.readOnScrape(
      "test",
      [backlog, byChannel],
      database.db,
      async (tx) => {
        await tx.execute(down ? "select * from no_such_table" : "select 1");
        backlog.set(3);
        byChannel.set({ channel: "email" }, 2);
      },
    );
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
  });

  it("PostgreSQL itself stops a slow read: it holds no connection after the scrape", async () => {
    const metrics = new Metrics({
      service: "test",
      port: 0,
      readTimeoutMs: 300,
    });
    const slow = metrics.gauge({ name: "test_slow", help: "Test." });
    metrics.readOnScrape("slow", [slow], database.db, async (tx) => {
      await tx.execute("select pg_sleep(4) as slow_scrape_read");
      slow.set(1);
    });
    const started = Date.now();
    const scrape = await metrics.scrape();
    expect(Date.now() - started).toBeLessThan(1_300);
    expect(metricValue(scrape, "test_slow")).toBeNaN();
    expect(
      metricValue(scrape, "metrics_read_errors_total", { reader: "slow" }),
    ).toBe(1);
    expect(await running("slow_scrape_read")).toBe(0);
  });

  it("concurrent scrapes share one round of reads", async () => {
    const metrics = new Metrics({ service: "test", port: 0 });
    const gauge = metrics.gauge({ name: "test_reads", help: "Test." });
    let reads = 0;
    metrics.readOnScrape("count", [gauge], database.db, async (tx) => {
      reads++;
      await tx.execute("select pg_sleep(0.2)");
      gauge.set(reads);
    });
    const scrapes = await Promise.all([
      metrics.scrape(),
      metrics.scrape(),
      metrics.scrape(),
    ]);
    expect(reads).toBe(1);
    for (const scrape of scrapes)
      expect(metricValue(scrape, "test_reads")).toBe(1);
    // The next scrape reads again.
    expect(metricValue(await metrics.scrape(), "test_reads")).toBe(2);
  });
});
