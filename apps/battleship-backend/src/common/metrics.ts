import { Injectable } from "@nestjs/common";
import { type Counter, Metrics } from "@outegro/nest-common";
import type { SessionEnd } from "../domain/game/types.js";
import type { MatchMode } from "../domain/rating.js";
import { SessionRegistry } from "../game/session.registry.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";

/** Battleship metrics (OPS-04): game sockets, live matches and how they end. */
@Injectable()
export class BattleshipMetrics {
  private readonly refused: Counter<"status">;
  private readonly ended: Counter<"mode" | "outcome">;

  constructor(
    metrics: Metrics,
    connections: ConnectionRegistry,
    sessions: SessionRegistry,
  ) {
    metrics.gauge({
      name: "battleship_game_sockets",
      help: "Open game sockets (/ws) in this process.",
      collect() {
        this.set(connections.stats().sockets);
      },
    });
    metrics.gauge({
      name: "battleship_live_matches",
      help: "Matches in placement or battle, by mode (bot, quick, private).",
      labelNames: ["mode"],
      collect() {
        for (const [mode, count] of Object.entries(sessions.countByMode()))
          this.set({ mode }, count);
      },
    });
    this.refused = metrics.counter({
      name: "battleship_socket_upgrades_refused_total",
      help: "Refused /ws upgrades by HTTP status: 401 ticket, 403 origin or account, 404 path, 429 sockets per player, 503 stopping or failure.",
      labelNames: ["status"],
    });
    this.ended = metrics.counter({
      name: "battleship_matches_finished_total",
      help: "Ended matches by mode and outcome: fleet_destroyed, resigned, timeout, disconnected; placement_timeout and moderation end without a result.",
      labelNames: ["mode", "outcome"],
    });
  }

  upgradeRefused(status: number) {
    this.refused.inc({ status: String(status) });
  }

  matchEnded(mode: MatchMode, end: SessionEnd) {
    this.ended.inc({ mode, outcome: end.reason });
  }
}
