import type { BotLevel } from "@outegro/battleship-engine";
import {
  battleshipFeatures,
  type CosmeticSlot,
  type Cosmetics,
  cosmeticUnlocked,
  effectiveCosmetics,
  premiumBotLevels,
} from "@outegro/contracts/battleship";

/** A grant as projected from `billing.grant.changed.v1`. */
export type GrantRecord = {
  readonly feature: string;
  readonly state: "active" | "revoked" | "expired";
  readonly validFrom: Date;
  /** null only for an explicitly perpetual grant. */
  readonly validUntil: Date | null;
};

/**
 * What a player may use right now. Payments owns the grants; the game checks
 * them on the server at the moment of use, so expiry needs no cron.
 */
export class Entitlements {
  private constructor(
    readonly features: ReadonlySet<string>,
    /** End of Premium; null without Premium or when it is perpetual. */
    readonly premiumUntil: Date | null,
  ) {}

  /** In force: active, started, and not ended (validUntil null means perpetual). */
  static isActive(grant: GrantRecord, now: Date): boolean {
    return (
      grant.state === "active" &&
      grant.validFrom.getTime() <= now.getTime() &&
      (grant.validUntil === null || grant.validUntil.getTime() > now.getTime())
    );
  }

  /**
   * The next moment the features change by time alone (a grant starts or
   * ends); null when nothing is scheduled.
   */
  static nextChange(grants: readonly GrantRecord[], now: Date): Date | null {
    let next: Date | null = null;
    for (const grant of grants) {
      if (grant.state !== "active") continue;
      for (const at of [grant.validFrom, grant.validUntil]) {
        if (at && at.getTime() > now.getTime() && (!next || at < next))
          next = at;
      }
    }
    return next;
  }

  static from(grants: readonly GrantRecord[], now: Date): Entitlements {
    const active = grants.filter((grant) => Entitlements.isActive(grant, now));
    const premium = active.filter(
      (grant) => grant.feature === battleshipFeatures.premium,
    );
    const perpetual = premium.some((grant) => grant.validUntil === null);
    const until = perpetual
      ? null
      : premium.reduce<Date | null>(
          (latest, grant) =>
            !latest || (grant.validUntil && grant.validUntil > latest)
              ? grant.validUntil
              : latest,
          null,
        );
    return new Entitlements(
      new Set(active.map((grant) => grant.feature)),
      until,
    );
  }

  get premium(): boolean {
    return this.features.has(battleshipFeatures.premium);
  }

  /** Hard and expert bots need Premium (TC-BS-08). */
  canPlayBot(level: BotLevel): boolean {
    return (
      !(premiumBotLevels as readonly string[]).includes(level) || this.premium
    );
  }

  /** Heatmap and replays are extended statistics (Premium). */
  get extendedStats(): boolean {
    return this.premium;
  }

  unlocked<S extends CosmeticSlot>(slot: S, item: Cosmetics[S]): boolean {
    return cosmeticUnlocked(slot, item, this.features);
  }

  /** What is actually shown: an item whose grant ended falls back (TC-BS-09). */
  effective(equipped: Cosmetics): Cosmetics {
    return effectiveCosmetics(equipped, this.features);
  }

  list(): string[] {
    return [...this.features].sort();
  }
}
