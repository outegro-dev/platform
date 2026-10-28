import { tmpdir } from "node:os";
import { Controller, Get, Inject } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from "@nestjs/terminus";
import { Public } from "@outegro/nest-common";
import { TOOL_RUNNER, type ToolRunner } from "../render/tools.js";

const CACHE_MS = 30_000;
const TIMEOUT_MS = 10_000;

/** The binaries a render needs, each run with its version flag. */
const TOOLS: [string, string[]][] = [
  ["xelatex", ["-version"]],
  ["pdfinfo", ["-v"]],
  ["pdffonts", ["-v"]],
  ["pdftotext", ["-v"]],
];

/**
 * /health and /health/deep, no auth. Both check that xelatex and poppler
 * run: they are part of this container, not a remote dependency, so a
 * broken toolchain should restart or replace the pod. Results are cached
 * for 30 s so probes do not spawn processes every few seconds.
 */
@Public()
@Controller("health")
export class HealthController {
  private cached: { at: number; problem: string | null } | undefined;

  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HealthIndicatorService)
    private readonly indicators: HealthIndicatorService,
    @Inject(TOOL_RUNNER) private readonly tools: ToolRunner,
  ) {}

  @Get()
  @HealthCheck()
  live() {
    return this.health.check([() => this.toolchain()]);
  }

  @Get("deep")
  @HealthCheck()
  ready() {
    return this.health.check([() => this.toolchain()]);
  }

  private async toolchain() {
    const session = this.indicators.check("xelatex");
    const now = Date.now();
    if (!this.cached || now - this.cached.at > CACHE_MS)
      this.cached = { at: now, problem: await this.probe() };
    return this.cached.problem
      ? session.down({ message: this.cached.problem })
      : session.up();
  }

  private async probe(): Promise<string | null> {
    for (const [command, args] of TOOLS) {
      const result = await this.tools.run(command, args, {
        cwd: tmpdir(),
        timeoutMs: TIMEOUT_MS,
      });
      if (result.code !== 0 || result.timedOut)
        return `${command} ${result.timedOut ? "timed out" : "is not runnable"}`;
    }
    return null;
  }
}
