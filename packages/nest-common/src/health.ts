import { Controller, Get, Global, Injectable, Module } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  TerminusModule,
} from "@nestjs/terminus";
import { Public } from "./auth.js";

type Check = () => Promise<void>;

/** Infrastructure modules register their readiness checks here. */
@Injectable()
export class HealthRegistry {
  private readonly checks = new Map<string, Check>();
  register(name: string, check: Check) {
    this.checks.set(name, check);
  }
  entries() {
    return [...this.checks.entries()];
  }
}

const withTimeout = (check: Check, ms: number) =>
  Promise.race([
    check(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms),
    ),
  ]);

/**
 * /health — liveness: the process answers. Never checks dependencies, so a
 * database outage does not restart every pod.
 * /health/deep — readiness: every registered dependency answers within 2 s.
 */
@Public()
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly registry: HealthRegistry,
  ) {}

  @Get()
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  @Get("deep")
  @HealthCheck()
  ready() {
    return this.health.check(
      this.registry.entries().map(([name, check]) => async () => {
        const session = this.indicators.check(name);
        try {
          await withTimeout(check, 2000);
          return session.up();
        } catch (error) {
          return session.down({ message: (error as Error).message });
        }
      }),
    );
  }
}

@Global()
@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: "json" })],
  controllers: [HealthController],
  providers: [HealthRegistry],
  exports: [HealthRegistry],
})
export class HealthModule {}
