import { MatchError } from "@outegro/battleship-engine";
import type { GameErrorCode } from "@outegro/contracts/battleship";

/**
 * A rejected game command. It maps to `error { code, ref }` on the socket and
 * never changes state (TC-BS-04).
 */
export class GameError extends Error {
  constructor(readonly code: GameErrorCode) {
    super(`Game command rejected: ${code}`);
  }

  /** Engine rule errors keep their code: the engine decides the rules. */
  static from(error: unknown): unknown {
    return error instanceof MatchError ? new GameError(error.code) : error;
  }
}
