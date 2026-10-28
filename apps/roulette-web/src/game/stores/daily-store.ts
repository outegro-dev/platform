import {
  type DailyClaim,
  type DailyStatus,
  dailyClaimSchema,
  dailyStatusSchema,
} from "@outegro/contracts/daily-bonus";
import { makeAutoObservable } from "mobx";
import { type DailyProblem, dailyProblemSchema } from "@/lib/daily";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type DailyOptions = {
  fetcher?: Fetcher;
  /** The balance after a claim (null: the wallet did not say). */
  onBalance?: (balance: number | null) => void;
};

/**
 * The bonus of the day behind the corner button: its status, the claim and
 * the ribbon's spin. Talks to the BFF only (`/api/daily`), which adds the
 * session and the device id. The balance changes once the ribbon stops, so
 * the prize is not given away before it shows.
 */
export class DailyStore {
  status: DailyStatus | null = null;
  loading = false;
  problem: DailyProblem | null = null;
  claim: DailyClaim | null = null;
  /** The ribbon is moving toward the prize. */
  spinning = false;
  private readonly fetcher: Fetcher;
  private readonly onBalance: (balance: number | null) => void;

  constructor(options: DailyOptions = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.onBalance = options.onBalance ?? (() => {});
    makeAutoObservable<DailyStore, "fetcher" | "onBalance">(
      this,
      { fetcher: false, onBalance: false },
      { autoBind: true },
    );
  }

  /** Ms until the bonus can be taken; 0 when it can, null when it never can. */
  msLeft(now: number): number | null {
    const status = this.status;
    if (!status || status.blocked) return null;
    if (status.available || !status.nextAt) return 0;
    return Math.max(0, Date.parse(status.nextAt) - now);
  }

  /** The button comes alive: takeable now. */
  isReady(now: number): boolean {
    return !this.spinning && this.msLeft(now) === 0;
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const response = await this.fetcher("/api/daily", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      this.applyStatus(response, body);
    } catch {
      this.setProblem({ error: "unavailable" });
    }
  }

  /** Takes the bonus; on success the ribbon starts and `finishSpin` ends it. */
  async take(): Promise<void> {
    if (this.spinning || this.loading) return;
    this.loading = true;
    this.problem = null;
    try {
      const response = await this.fetcher("/api/daily", {
        method: "POST",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      this.applyClaim(response, body);
    } catch {
      this.setProblem({ error: "unavailable" });
    }
  }

  /** The ribbon stopped on the prize: now the balance changes. */
  finishSpin(): void {
    if (!this.spinning || !this.claim) return;
    this.spinning = false;
    this.onBalance(this.claim.balance);
  }

  private applyStatus(response: Response, body: unknown) {
    this.loading = false;
    if (response.ok) {
      const status = dailyStatusSchema.safeParse(body);
      if (status.success) {
        this.status = status.data;
        this.problem = status.data.blocked
          ? { error: "blocked", reason: status.data.blocked }
          : null;
        return;
      }
    }
    this.setProblem(problemOf(body));
  }

  private applyClaim(response: Response, body: unknown) {
    this.loading = false;
    if (response.ok) {
      const claim = dailyClaimSchema.safeParse(body);
      if (claim.success) {
        this.claim = claim.data;
        this.spinning = true;
        if (this.status)
          this.status = {
            ...this.status,
            available: false,
            nextAt: claim.data.nextAt,
            streak: claim.data.streak,
          };
        return;
      }
    }
    const problem = problemOf(body);
    this.setProblem(problem);
    // "Not yet": the status says until when.
    if (problem.error === "not_yet") void this.load();
  }

  private setProblem(problem: DailyProblem) {
    this.loading = false;
    this.problem = problem;
  }
}

function problemOf(body: unknown): DailyProblem {
  const parsed = dailyProblemSchema.safeParse(body);
  return parsed.success ? parsed.data : { error: "unavailable" };
}
