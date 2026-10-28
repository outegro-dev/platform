import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type { FairInfo, FairReveal } from "@outegro/contracts/roulette";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { colorOf, roll } from "@outegro/roulette-engine";
import { and, eq, max, sql } from "drizzle-orm";
import type { FairRollDatabase } from "../common/database.js";
import { FairRollMetrics } from "../common/metrics.js";
import { chainConfig } from "../config/config.js";
import { chains, reveals } from "../db/schema.js";
import { SeedChain } from "./chain.js";

/**
 * Reveals rounds strictly in order (ADR-012): round k only right after
 * k − 1, and a repeat of the last one (the engine may have crashed after
 * asking). Anything else is a 409: nobody, the engine included, learns a
 * future outcome early. Reveals are serialised by an advisory lock and
 * stored, so the order survives restarts.
 */
@Injectable()
export class RevealService implements OnApplicationBootstrap {
  private readonly logger = new Logger("RevealService");
  private chain: SeedChain | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: FairRollDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(chainConfig.KEY)
    private readonly config: ConfigType<typeof chainConfig>,
    private readonly metrics: FairRollMetrics,
  ) {}

  /** Builds the chain and records its commit; a changed public seed refuses to start. */
  async onApplicationBootstrap() {
    const started = performance.now();
    const chain = new SeedChain(
      Buffer.from(this.config.root, "hex"),
      this.config.length,
    );
    const [stored] = await this.database.db
      .insert(chains)
      .values({
        commit: chain.commit,
        publicSeed: this.config.publicSeed,
        length: chain.length,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (!stored) {
      const [existing] = await this.database.db
        .select()
        .from(chains)
        .where(eq(chains.commit, chain.commit));
      if (
        existing?.publicSeed !== this.config.publicSeed ||
        existing.length !== chain.length
      )
        throw new Error(
          "FAIR_ROLL_PUBLIC_SEED or FAIR_ROLL_CHAIN_LENGTH differs from the published chain",
        );
    }
    this.chain = chain;
    this.metrics.lastRevealed(await this.lastRevealed());
    this.logger.log(
      {
        commit: chain.commit,
        length: chain.length,
        ms: Math.round(performance.now() - started),
      },
      "Seed chain ready",
    );
  }

  private get current(): SeedChain {
    if (!this.chain) throw new AppError("DEPENDENCY_UNAVAILABLE");
    return this.chain;
  }

  async info(): Promise<FairInfo> {
    const chain = this.current;
    return {
      commit: chain.commit,
      publicSeed: this.config.publicSeed,
      chainLength: chain.length,
      lastRevealed: await this.lastRevealed(),
    };
  }

  async reveal(round: number): Promise<FairReveal> {
    const chain = this.current;
    if (round > chain.length) {
      this.metrics.reveal("exhausted");
      throw new AppError("UNPROCESSABLE", {
        message: "the chain is exhausted; a new season needs a new root",
      });
    }
    const result = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${chain.commit}))`,
      );
      const [last] = await tx
        .select({ round: max(reveals.round) })
        .from(reveals)
        .where(eq(reveals.commit, chain.commit));
      const lastRound = last?.round ?? 0;
      if (round === lastRound) {
        const [stored] = await tx
          .select()
          .from(reveals)
          .where(
            and(eq(reveals.commit, chain.commit), eq(reveals.round, round)),
          );
        if (!stored) throw new Error("the last reveal vanished");
        return { stored, repeat: true };
      }
      if (round !== lastRound + 1) return null;
      const seed = chain.seedAt(round);
      const number = await roll(seed, this.config.publicSeed, round);
      const [stored] = await tx
        .insert(reveals)
        .values({
          commit: chain.commit,
          round,
          seed,
          number,
          revealedAt: this.clock.now(),
        })
        .returning();
      if (!stored) throw new Error("reveal not stored");
      return { stored, repeat: false };
    });
    if (!result) {
      this.metrics.reveal("out_of_order");
      throw new AppError("CONFLICT", {
        message: "rounds are revealed strictly in order",
      });
    }
    this.metrics.reveal(result.repeat ? "repeat" : "revealed");
    if (!result.repeat) this.metrics.lastRevealed(round);
    const { stored } = result;
    return {
      round: stored.round,
      seed: stored.seed,
      number: stored.number,
      color: colorOf(stored.number),
    };
  }

  private async lastRevealed(): Promise<number> {
    const [last] = await this.database.db
      .select({ round: max(reveals.round) })
      .from(reveals)
      .where(eq(reveals.commit, this.current.commit));
    return last?.round ?? 0;
  }
}
