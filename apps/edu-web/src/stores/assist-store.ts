import type { AssistStatus } from "@outegro/contracts/edu";
import { makeAutoObservable } from "mobx";

/** Today's answers as edu-backend last counted them. */
export type AssistQuota = { usedToday: number; dailyLimit: number };

type Init = {
  /**
   * `GET /v1/me/assist` with the page; null when unknown: signed out (the
   * status is a signed-in reader's), or it did not load.
   */
  status: AssistStatus | null;
};

type Deps = {
  /** The clock: when today's limit resets. */
  now: () => Date;
};

const DAY_MS = 24 * 3600_000;

/**
 * The reading assistant on one page: whether its helpers are there at all
 * and how many answers are left today. It fails closed: the helpers are
 * there only when the page came with the assistant on. Off, or not known
 * to be on (signed out, or the status did not load), the page shows no
 * helper anywhere; a request refused as disabled takes them all away too.
 * The quota follows the server (`done` events, a 429), and counts an
 * answer the reader stopped or lost once its first words had come, as
 * edu-backend does.
 */
export class AssistStore {
  enabled: boolean;
  quota: AssistQuota | null;
  private readonly deps: Deps;

  constructor(init: Init, deps: Deps) {
    this.enabled = init.status?.enabled === true;
    this.quota = init.status
      ? {
          usedToday: init.status.usedToday,
          dailyLimit: init.status.dailyLimit,
        }
      : null;
    this.deps = deps;
    makeAutoObservable<this, "deps">(this, { deps: false }, { autoBind: true });
  }

  /** Answers left today; null while the quota is unknown. */
  get remaining(): number | null {
    if (!this.quota) return null;
    return Math.max(0, this.quota.dailyLimit - this.quota.usedToday);
  }

  get exhausted(): boolean {
    return this.remaining === 0;
  }

  /**
   * When today's answers come back: the next midnight UTC (the limit is
   * per UTC day). Read when the message is shown, never stored.
   */
  resetsAt(): Date {
    const now = this.deps.now().getTime();
    return new Date(Math.floor(now / DAY_MS) * DAY_MS + DAY_MS);
  }

  /** A complete answer: the server's count after it. */
  answered(quota: AssistQuota) {
    this.quota = { usedToday: quota.usedToday, dailyLimit: quota.dailyLimit };
  }

  /** An answer that ended early after its first words: it counted. */
  spent() {
    if (this.quota)
      this.quota = {
        ...this.quota,
        usedToday: Math.min(this.quota.dailyLimit, this.quota.usedToday + 1),
      };
  }

  /** Refused with 429: today's answers are used up. */
  limitReached() {
    if (this.quota)
      this.quota = { ...this.quota, usedToday: this.quota.dailyLimit };
  }

  /** Refused as disabled: the helpers leave the page. */
  disable() {
    this.enabled = false;
  }
}
