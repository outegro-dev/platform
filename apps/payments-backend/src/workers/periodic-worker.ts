import type {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";

/**
 * A loop that runs `runOnce` every interval. Outside tests it starts by
 * itself; tests call `tick()` with a ManualClock and never sleep.
 */
export abstract class PeriodicWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  protected abstract readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  protected constructor(
    private readonly autoStart: boolean,
    private readonly intervalMs: number,
  ) {}

  protected abstract runOnce(): Promise<number>;

  onApplicationBootstrap() {
    if (this.autoStart) this.schedule(this.intervalMs);
  }

  onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** One pass; returns how many items it handled (0 if a pass is running). */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.runOnce();
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        "Worker pass failed",
      );
      return 0;
    } finally {
      this.running = false;
      if (this.autoStart) this.schedule(this.intervalMs);
    }
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
  }
}
