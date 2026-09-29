import {
  type BotLevel,
  classicRules,
  createBot,
  type GameRules,
  type Random,
  RandomPlacement,
  type ShipPlacement,
  type ShotStrategy,
  type TargetView,
} from "@outegro/battleship-engine";

/**
 * The server-side opponent: an engine strategy that sees only what a human
 * would (the target view), plus a human-like pause before each shot.
 */
export class BotPlayer {
  private constructor(
    readonly level: BotLevel,
    private readonly strategy: ShotStrategy,
    private readonly random: Random,
    private readonly thinkMinMs: number,
    private readonly thinkMaxMs: number,
  ) {}

  static create(
    level: BotLevel,
    random: Random,
    think: { minMs: number; maxMs: number },
  ): BotPlayer {
    return new BotPlayer(
      level,
      createBot(level, random),
      random,
      think.minMs,
      think.maxMs,
    );
  }

  /** The bot's fleet, placed at random by the engine. */
  static placeFleet(
    random: Random,
    rules: GameRules = classicRules,
  ): ShipPlacement[] {
    return new RandomPlacement(random).place(rules);
  }

  /** Milliseconds to "think" before the next shot, within [min, max]. */
  thinkingTime(): number {
    const span = this.thinkMaxMs - this.thinkMinMs;
    return this.thinkMinMs + Math.floor(this.random.next() * (span + 1));
  }

  chooseShot(view: TargetView): { x: number; y: number } {
    const cell = this.strategy.next(view);
    return { x: cell.x, y: cell.y };
  }
}
