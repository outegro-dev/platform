import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { type Database, type Executor, readWithTimeout } from "@outegro/db";
import {
  Counter,
  type CounterConfiguration,
  collectDefaultMetrics,
  Gauge,
  type GaugeConfiguration,
  Histogram,
  type HistogramConfiguration,
  Registry,
} from "@prometheus-io/client";
import { safeMode } from "./safe-mode.js";

export type { Counter, Gauge, Histogram } from "@prometheus-io/client";

export type MetricsOptions = {
  /** The `service` label of every series. */
  service: string;
  /** Port of the separate `/metrics` listener; 0 turns it off. */
  port: number;
  /** statement_timeout of a gauge read (default 2 s). */
  readTimeoutMs?: number;
};

const METRICS_OPTIONS = Symbol("METRICS_OPTIONS");
const READ_TIMEOUT_MS = 2000;
/**
 * How much longer than its statement_timeout a scrape waits for a read:
 * room for a busy pool, after which the read counts as failed.
 */
const READ_WAIT_MARGIN_MS = 1000;

type Own<C> = Omit<C, "registers">;
/** What a failed read does to a gauge of any label set. */
type ReadGauge = { set(value: number): void; reset(): void };

function withTimeout<T>(work: Promise<T>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The application's own Prometheus registry (not the library's global one,
 * so an app restarted in the same process starts clean): Node and process
 * defaults plus the service's metrics. Label values come from small fixed
 * sets only; user, order, request and trace ids belong in logs (9.4).
 */
@Injectable()
export class Metrics {
  readonly registry = new Registry();
  private readonly logger = new Logger("Metrics");
  private readonly reads: (() => Promise<void>)[] = [];
  private readonly unlabelled = new WeakSet<ReadGauge>();
  private readonly readErrors: Counter<"reader">;
  private readonly readTimeoutMs: number;
  /** The round of reads in progress; scrapes meanwhile wait for it. */
  private reading: Promise<void> | null = null;

  constructor(@Inject(METRICS_OPTIONS) options: MetricsOptions) {
    this.readTimeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;
    this.registry.setDefaultLabels({ service: options.service });
    collectDefaultMetrics({ register: this.registry });
    // 1 while the service runs in SAFE_MODE: an alert keeps it from being forgotten.
    this.gauge({
      name: "safe_mode",
      help: "1 when the service runs with SAFE_MODE (workers off), else 0.",
    }).set(safeMode() ? 1 : 0);
    this.readErrors = this.counter({
      name: "metrics_read_errors_total",
      help: "Gauge reads from a store that failed or timed out during a scrape.",
      labelNames: ["reader"],
    });
  }

  counter<T extends string = never>(config: Own<CounterConfiguration<T>>) {
    return new Counter<T>({ ...config, registers: [this.registry] });
  }

  gauge<T extends string = never>(config: Own<GaugeConfiguration<T>>) {
    const gauge = new Gauge<T>({ ...config, registers: [this.registry] });
    if (!config.labelNames?.length) this.unlabelled.add(gauge);
    return gauge;
  }

  histogram<T extends string = never>(config: Own<HistogramConfiguration<T>>) {
    return new Histogram<T>({ ...config, registers: [this.registry] });
  }

  /**
   * Sets `gauges` from the database (outbox, queues) right before every
   * scrape; `read` should be one cheap query through `tx`. It runs in its
   * own read-only transaction with a statement_timeout, so PostgreSQL stops
   * a slow read and frees its connection. When it fails or times out its
   * gauges turn unknown (NaN, or no series) instead of failing the whole
   * scrape.
   */
  readOnScrape(
    reader: string,
    gauges: ReadGauge[],
    db: Database<Record<string, unknown>>,
    read: (tx: Executor) => Promise<void>,
  ) {
    let failing = false;
    this.reads.push(async () => {
      try {
        await withTimeout(
          readWithTimeout(db, this.readTimeoutMs, read),
          this.readTimeoutMs + READ_WAIT_MARGIN_MS,
        );
        failing = false;
      } catch (error) {
        for (const gauge of gauges) {
          if (this.unlabelled.has(gauge)) gauge.set(Number.NaN);
          else gauge.reset();
        }
        this.readErrors.inc({ reader });
        if (!failing)
          this.logger.warn(
            { reader, err: (error as Error).message },
            "Metrics read failed",
          );
        failing = true;
      }
    });
  }

  /**
   * Prometheus text exposition, as served on METRICS_PORT. Scrapes that
   * arrive while the reads run share that round instead of starting their
   * own, so the database sees at most one round at a time.
   */
  async scrape() {
    this.reading ??= Promise.all(this.reads.map((read) => read()))
      .then(() => undefined)
      .finally(() => {
        this.reading = null;
      });
    await this.reading;
    return this.registry.metrics();
  }
}

const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
/** 5 ms to 10 s; 0.3 and 0.5 s are the read API and webhook targets (9.7). */
const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5, 10,
];

const UNMATCHED = Symbol("unmatched");

type RoutedRequest = IncomingMessage & {
  baseUrl?: string;
  route?: { path?: unknown };
  [UNMATCHED]?: true;
};

/** The handler's route template (`/v1/matches/:id`), never the raw path. */
const routeOf = (req: RoutedRequest) =>
  !req[UNMATCHED] && typeof req.route?.path === "string"
    ? `${req.baseUrl ?? ""}${req.route.path}`
    : "unmatched";

/**
 * Requests and their latency by method, route template (`unmatched` when no
 * handler matched) and status class. Health probes are left out.
 */
@Injectable()
export class HttpMetrics implements OnModuleInit {
  private readonly requests: Counter<"method" | "route" | "status_class">;
  private readonly duration: Histogram<"method" | "route" | "status_class">;

  constructor(
    metrics: Metrics,
    private readonly adapterHost: HttpAdapterHost,
  ) {
    const labelNames = ["method", "route", "status_class"] as const;
    this.requests = metrics.counter({
      name: "http_server_requests_total",
      help: "HTTP requests by method, route template and status class.",
      labelNames,
    });
    this.duration = metrics.histogram({
      name: "http_server_request_duration_seconds",
      help: "HTTP request latency by method, route template and status class.",
      labelNames,
      buckets: DURATION_BUCKETS,
    });
  }

  /**
   * Nest mounts module middleware (the request logger) as routes too, so
   * `req.route` alone cannot tell a handler from a pass-through. Mounted now,
   * after the routes and before Nest's not-found handler, this sees exactly
   * the requests no handler answered.
   */
  onModuleInit() {
    this.adapterHost.httpAdapter?.use(
      (req: RoutedRequest, _res: ServerResponse, next: () => void) => {
        req[UNMATCHED] = true;
        next();
      },
    );
  }

  /** Express middleware; `configureApp` mounts it before any route. */
  readonly middleware = (
    req: RoutedRequest,
    res: ServerResponse,
    next: () => void,
  ) => {
    const started = performance.now();
    res.once("finish", () => {
      const route = routeOf(req);
      if (route === "/health" || route.startsWith("/health/")) return;
      const method = req.method ?? "";
      const labels = {
        method: METHODS.has(method) ? method : "other",
        route,
        status_class: `${Math.floor(res.statusCode / 100)}xx`,
      };
      this.requests.inc(labels);
      this.duration.observe(labels, (performance.now() - started) / 1000);
    });
    next();
  };
}

/**
 * The separate listener: only `GET /metrics`, never on the application port,
 * so metrics cannot leak through an Ingress that routes the application.
 */
@Injectable()
export class MetricsServer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("Metrics");
  private server: Server | undefined;

  constructor(
    @Inject(METRICS_OPTIONS) private readonly options: MetricsOptions,
    private readonly metrics: Metrics,
  ) {}

  /** The bound port; null while the listener is off. */
  get port(): number | null {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  async onApplicationBootstrap() {
    if (this.options.port === 0) return;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.on("error", (error) =>
      this.logger.error({ err: error.message }, "Metrics listener error"),
    );
    this.server = server;
    this.logger.log({ port: this.port }, "Metrics listener started");
  }

  async onApplicationShutdown() {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Prometheus keeps its connection open between scrapes.
      server.closeAllConnections();
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.url?.split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET" }).end();
      return;
    }
    try {
      const body = await this.metrics.scrape();
      res
        .writeHead(200, { "content-type": this.metrics.registry.contentType })
        .end(body);
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        "Metrics scrape failed",
      );
      res.writeHead(500).end();
    }
  }
}

/**
 * Prometheus metrics of a service (OPS-04): the registry every module adds
 * to, HTTP request metrics (mounted by `configureApp`, so it is required
 * there) and the listener on its own port.
 */
@Global()
@Module({})
export class MetricsModule {
  static forRootAsync(options: {
    inject?: (string | symbol | (abstract new (...args: never[]) => unknown))[];
    useFactory: (...args: never[]) => MetricsOptions;
  }): DynamicModule {
    return {
      module: MetricsModule,
      providers: [
        {
          provide: METRICS_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        Metrics,
        HttpMetrics,
        MetricsServer,
      ],
      exports: [Metrics, HttpMetrics],
    };
  }
}
