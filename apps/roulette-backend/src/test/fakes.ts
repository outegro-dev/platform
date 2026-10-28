import { createHash } from "node:crypto";
import type { FairInfo, FairReveal } from "@outegro/contracts/roulette";
import { colorOf, roll } from "@outegro/roulette-engine";
import { FairRollError, type FairRollPort } from "../fair/fair-roll.port.js";
import type { IdentityPort, IdentityUser } from "../identity/identity.js";
import { InMemoryWallet } from "../wallet/memory-wallet.js";
import type {
  CreditItem,
  CreditResult,
  DebitInput,
} from "../wallet/wallet.port.js";

/**
 * fair-roll in the test process: the same chain construction and roll, the
 * same in-order rule (repeat of the last round, 409 for any other). It also
 * tells the test which number a round will get, so bets can aim at it.
 */
export class LocalFairRoll implements FairRollPort {
  private readonly seeds: string[];
  private last = 0;
  readonly publicSeed = "test-public-seed";
  reveals = 0;

  constructor(length = 2000, root = Buffer.alloc(32, 9)) {
    this.seeds = new Array<string>(length + 1);
    let link = root;
    this.seeds[length] = link.toString("hex");
    for (let i = length - 1; i >= 0; i--) {
      link = createHash("sha256").update(link).digest();
      this.seeds[i] = link.toString("hex");
    }
  }

  get commit(): string {
    return this.seeds[0] ?? "";
  }

  seedOf(round: number): string {
    return this.seeds[round] ?? "";
  }

  /** The number round `round` will get: test-only foresight. */
  numberOf(round: number): Promise<number> {
    return roll(this.seedOf(round), this.publicSeed, round);
  }

  async chain(): Promise<FairInfo> {
    return {
      commit: this.commit,
      publicSeed: this.publicSeed,
      chainLength: this.seeds.length - 1,
      lastRevealed: this.last,
    };
  }

  async reveal(round: number): Promise<FairReveal> {
    if (round !== this.last && round !== this.last + 1)
      throw new FairRollError(409, `out of order: ${round} after ${this.last}`);
    this.last = round;
    this.reveals += 1;
    const number = await this.numberOf(round);
    return { round, seed: this.seedOf(round), number, color: colorOf(number) };
  }
}

type Gate = { release: () => void; reached: Promise<void> };

/**
 * The in-memory wallet with test handles: `holdNextDebit()` makes the next
 * debit wait until released (a slow or hung wallet), and every credit batch
 * is recorded.
 */
export class TestWallet extends InMemoryWallet {
  readonly creditCalls: number[] = [];
  readonly rollbacks: string[] = [];
  private readonly holds: { open: Promise<void>; reached: () => void }[] = [];

  /** The next debit waits for `release()`; `reached` resolves when it starts waiting. */
  holdNextDebit(): Gate {
    let release = () => {};
    let reached = () => {};
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reachedPromise = new Promise<void>((resolve) => {
      reached = resolve;
    });
    this.holds.push({ open, reached });
    return { release, reached: reachedPromise };
  }

  override async debit(input: DebitInput): Promise<{ balance: number }> {
    const hold = this.holds.shift();
    if (hold) {
      hold.reached();
      await hold.open;
    }
    return super.debit(input);
  }

  override async creditBatch(items: CreditItem[]): Promise<CreditResult[]> {
    this.creditCalls.push(items.length);
    return super.creditBatch(items);
  }

  override async rollback(ref: string) {
    this.rollbacks.push(ref);
    return super.rollback(ref);
  }
}

/** Identity's lookup in the test process: everyone active at version 0 unless set. */
export class TestIdentity implements IdentityPort {
  private readonly users = new Map<string, IdentityUser>();

  set(userId: string, user: IdentityUser) {
    this.users.set(userId, user);
  }

  async lookup(userId: string): Promise<IdentityUser> {
    return this.users.get(userId) ?? { status: "active", accessVersion: 0 };
  }
}
