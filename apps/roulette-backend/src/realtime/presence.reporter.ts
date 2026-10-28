import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { EngineDriver } from "../rounds/engine.driver.js";
import { RoundStore } from "../rounds/round.store.js";
import { ConnectionRegistry } from "./connection.registry.js";

const REPORT_EVERY_MS = 1000;

/** Reports this replica's open sockets each second, so the console counts them all. */
@Injectable()
export class PresenceReporter
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger("PresenceReporter");
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: RoundStore,
    private readonly registry: ConnectionRegistry,
    private readonly driver: EngineDriver,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.report(), REPORT_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async report() {
    try {
      await this.store.reportOnline(
        this.driver.instanceId,
        this.registry.stats().sockets,
      );
    } catch (error) {
      this.logger.warn(
        { err: (error as Error).message },
        "Presence report failed",
      );
    }
  }
}
