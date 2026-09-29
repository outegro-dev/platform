import { makeAutoObservable, observable, runInAction } from "mobx";
import type { CancelOutcome, Subscription } from "@/lib/payments/model";
import { canCancel } from "@/lib/payments/status";
import { browserIsOnline } from "./scheduler";

export type CancelProblem = "unavailable" | "offline" | "signed-out" | "gone";
/** What the server said after the cancel command, for the confirmation line. */
export type CancelResult = "cancelling" | "cancel_requested" | "unchanged";

type Deps = {
  cancel: (subscriptionId: string) => Promise<CancelOutcome>;
  isOnline?: () => boolean;
};

/**
 * One subscription card: its current state and the "cancel renewal" flow.
 * The server decides the outcome; the card shows exactly the state it
 * returns (cancel_requested while Lava has not confirmed, cancelling once
 * it has). A failed or timed-out call leaves the old state and offers a
 * retry, which is safe: the command has no second effect.
 */
export class SubscriptionStore {
  subscription: Subscription;
  dialogOpen = false;
  pending = false;
  problem: CancelProblem | null = null;
  result: CancelResult | null = null;

  private readonly cancel: Deps["cancel"];
  private readonly isOnline: () => boolean;

  constructor(initial: Subscription, deps: Deps) {
    this.subscription = initial;
    this.cancel = deps.cancel;
    this.isOnline = deps.isOnline ?? browserIsOnline;
    makeAutoObservable<this, "cancel" | "isOnline">(
      this,
      { subscription: observable.ref, cancel: false, isOnline: false },
      { autoBind: true },
    );
  }

  get canCancel() {
    return canCancel(this.subscription);
  }

  setDialogOpen(open: boolean) {
    // The dialog stays until the running command answers.
    if (this.pending) return;
    this.dialogOpen = open;
    if (open) this.problem = null;
  }

  async confirm() {
    if (this.pending) return;
    if (!this.isOnline()) {
      this.problem = "offline";
      return;
    }
    this.pending = true;
    this.problem = null;
    let outcome: CancelOutcome;
    try {
      outcome = await this.cancel(this.subscription.id);
    } catch {
      outcome = { kind: "unavailable" };
    }
    runInAction(() => {
      this.pending = false;
      switch (outcome.kind) {
        case "ok": {
          const next = outcome.subscription;
          this.subscription = next;
          this.result =
            next.state === "cancelling" || next.state === "cancel_requested"
              ? next.state
              : "unchanged";
          this.dialogOpen = false;
          break;
        }
        case "unauthorized":
          this.problem = "signed-out";
          break;
        case "not-found":
          this.problem = "gone";
          break;
        default:
          this.problem = "unavailable";
      }
    });
  }
}
