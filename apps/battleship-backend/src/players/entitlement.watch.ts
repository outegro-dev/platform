import { Inject, Injectable, Logger } from "@nestjs/common";
import { SCHEDULER } from "../common/tokens.js";
import type { Scheduler, TimerHandle } from "../domain/scheduler.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";
import { EntitlementsService } from "./entitlements.service.js";
import { PlayersService } from "./players.service.js";

/**
 * Grants also change by time alone (Premium ends at validUntil). While a
 * player is online, the next such moment is scheduled and `player.updated`
 * goes out then, so an expired skin disappears like a revoked one (TC-BS-09).
 */
@Injectable()
export class EntitlementWatch {
  private readonly logger = new Logger("EntitlementWatch");
  private readonly timers = new Map<string, TimerHandle>();

  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly players: PlayersService,
    private readonly registry: ConnectionRegistry,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
  ) {}

  /** (Re)arms the next change for an online player. */
  async watch(userId: string): Promise<void> {
    this.unwatch(userId);
    if (!this.registry.isOnline(userId)) return;
    const next = await this.entitlements.nextChange(userId);
    // Another watch may have armed a timer meanwhile: keep only this one.
    this.unwatch(userId);
    if (!next || !this.registry.isOnline(userId)) return;
    this.timers.set(
      userId,
      this.scheduler.at(next, async () => {
        this.timers.delete(userId);
        try {
          await this.players.pushUpdate(userId);
          await this.watch(userId);
        } catch (error) {
          this.logger.warn(
            { err: (error as Error).message },
            "Grant change push failed",
          );
        }
      }),
    );
  }

  unwatch(userId: string): void {
    this.timers.get(userId)?.cancel();
    this.timers.delete(userId);
  }
}
