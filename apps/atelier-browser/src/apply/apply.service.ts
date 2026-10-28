import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type {
  BrowserApplyRequest,
  BrowserApplyResponse,
} from "@outegro/contracts/atelier";
import { AppError, Metrics } from "@outegro/nest-common";
import type { BrowserContext } from "playwright";
import { BrowserPool } from "../browser/browser-pool.js";
import { browserConfig } from "../config/config.js";
import { runApply } from "../engine/apply.js";

/** Test seams: local fixtures instead of real ATS hosts. */
export type ApplyOverrides = {
  /** Open applyUrl as given, without the adapter's host check. */
  trustUrl?: boolean;
  /** Abort every request to another host (tests never reach the internet). */
  allowHosts?: string[];
};
export const APPLY_OVERRIDES = Symbol("APPLY_OVERRIDES");

/** First-come slots for browser contexts (BROWSER_CONCURRENCY). */
class Slots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly size: number) {}

  acquire(timeoutMs: number): Promise<() => void> {
    const release = () => {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    };
    if (this.active < this.size) {
      this.active++;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve(release);
      };
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(grant);
        if (at !== -1) this.waiting.splice(at, 1);
        reject(
          new AppError("DEPENDENCY_UNAVAILABLE", { message: "browser busy" }),
        );
      }, timeoutMs);
      this.waiting.push(grant);
    });
  }
}

const reasonCode = (reason: string | null) => reason?.split(":")[0] ?? null;

@Injectable()
export class ApplyService {
  private readonly logger = new Logger("Apply");
  private readonly slots: Slots;
  private readonly total;
  private readonly duration;

  constructor(
    private readonly pool: BrowserPool,
    metrics: Metrics,
    @Inject(browserConfig.KEY)
    private readonly config: ConfigType<typeof browserConfig>,
    @Inject(APPLY_OVERRIDES)
    private readonly overrides: ApplyOverrides,
  ) {
    this.slots = new Slots(config.concurrency);
    this.total = metrics.counter<"ats" | "mode" | "status">({
      name: "atelier_browser_apply_total",
      help: "Apply requests by ATS, mode and outcome status.",
      labelNames: ["ats", "mode", "status"],
    });
    this.duration = metrics.histogram<"ats" | "mode">({
      name: "atelier_browser_apply_duration_seconds",
      help: "Time of one apply request in the browser, queue excluded.",
      labelNames: ["ats", "mode"],
      buckets: [5, 10, 20, 30, 45, 60, 90, 120, 180],
    });
  }

  async apply(req: BrowserApplyRequest): Promise<BrowserApplyResponse> {
    const release = await this.slots.acquire(this.config.queueTimeoutMs);
    const started = Date.now();
    let context: BrowserContext | null = null;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let result: BrowserApplyResponse;
    try {
      context = await this.pool.newContext();
      const open = context;
      timer = setTimeout(() => {
        timedOut = true;
        void open.close().catch(() => {});
      }, this.config.timeoutMs);
      await this.guard(open);
      result = await runApply(open, req, {
        deadline: started + this.config.timeoutMs,
        trustUrl: this.overrides.trustUrl ?? false,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = (error as Error).message?.split("\n")[0] ?? "unknown";
      if (!timedOut)
        this.logger.warn({ ats: req.ats, err: message }, "Apply run failed");
      result = {
        status: "failed",
        reason: timedOut ? "timeout" : `error: ${message}`.slice(0, 300),
        unanswered: [],
        filled: [],
        screenshotBase64: null,
        confirmation: null,
      };
    } finally {
      clearTimeout(timer);
      await context?.close().catch(() => {});
      release();
    }
    const seconds = (Date.now() - started) / 1000;
    this.total.inc({ ats: req.ats, mode: req.mode, status: result.status });
    this.duration.observe({ ats: req.ats, mode: req.mode }, seconds);
    // Never the answers, the CV or the person's fields: only the outcome.
    this.logger.log(
      {
        ats: req.ats,
        mode: req.mode,
        host: safeHost(req.applyUrl),
        status: result.status,
        reason: reasonCode(result.reason),
        filled: result.filled.length,
        unanswered: result.unanswered.length,
        requiredUnanswered: result.unanswered.filter((field) => field.required)
          .length,
        ms: Date.now() - started,
      },
      "Apply finished",
    );
    return result;
  }

  private async guard(context: BrowserContext) {
    const allow = this.overrides.allowHosts;
    if (!allow) return;
    await context.route("**/*", (route) => {
      const url = route.request().url();
      const host = url.startsWith("data:") ? "" : safeHost(url);
      return host === "" || allow.includes(host)
        ? route.continue()
        : route.abort();
    });
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
