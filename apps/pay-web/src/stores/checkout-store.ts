import { makeAutoObservable, runInAction } from "mobx";
import type { CheckoutInput, CheckoutOutcome } from "@/lib/payments/model";
import { browserIsOnline } from "./scheduler";

export type CheckoutProblem =
  | "owned"
  | "closed"
  | "gone"
  | "blocked"
  | "failed"
  | "slow"
  | "unavailable"
  | "signedOut"
  | "offline";

export type CheckoutStatus = "idle" | "starting" | "preparing" | "redirecting";

/**
 * Idempotency keys per product and currency. The same key returns the same
 * order, so a retry after a timeout, or buying again after coming back from
 * an unpaid Lava page, never creates a second order.
 */
export type KeyVault = {
  get(scope: string): string | null;
  set(scope: string, key: string): void;
  clear(scope: string): void;
};

type Deps = {
  start: (input: CheckoutInput) => Promise<CheckoutOutcome>;
  keys: KeyVault;
  newKey: () => string;
  /** Leave for the payment page (already checked against the allowlist). */
  navigate: (url: string) => void;
  /** Go to one of our order pages. */
  openOrder: (orderId: string) => void;
  wait: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
  /** Tries while the invoice is being created, before "taking a while". */
  preparingAttempts?: number;
  preparingDelayMs?: number;
};

/**
 * Buying one product: pick a currency, start the checkout, then go to the
 * payment page the server approved. The browser sends only the product,
 * the currency and its key; the server decides price, buyer and URL.
 */
export class CheckoutStore {
  currency: string;
  status: CheckoutStatus = "idle";
  problem: CheckoutProblem | null = null;
  orderId: string | null = null;

  private readonly productKey: string;
  private readonly currencies: readonly string[];
  private readonly deps: Required<Omit<Deps, "isOnline">> & {
    isOnline: () => boolean;
  };

  constructor(
    product: { key: string; currencies: readonly string[] },
    currency: string,
    deps: Deps,
  ) {
    this.productKey = product.key;
    this.currencies = product.currencies;
    this.currency = product.currencies.includes(currency)
      ? currency
      : (product.currencies[0] ?? currency);
    this.deps = {
      preparingAttempts: 4,
      preparingDelayMs: 2_000,
      isOnline: browserIsOnline,
      ...deps,
    };
    makeAutoObservable<this, "productKey" | "currencies" | "deps">(
      this,
      { productKey: false, currencies: false, deps: false },
      { autoBind: true },
    );
  }

  get busy() {
    return this.status !== "idle";
  }

  selectCurrency(currency: string) {
    if (this.busy || !this.currencies.includes(currency)) return;
    this.currency = currency;
    this.problem = null;
  }

  /** Back from the payment page through the browser's back button. */
  resumeAfterReturn() {
    if (this.status === "redirecting") this.status = "idle";
  }

  async buy() {
    if (this.busy) return;
    if (!this.deps.isOnline()) {
      this.problem = "offline";
      return;
    }
    this.problem = null;
    this.status = "starting";
    const scope = `${this.productKey}:${this.currency}`;
    const input = { productKey: this.productKey, currency: this.currency };
    let key = this.deps.keys.get(scope) ?? this.freshKey(scope);
    let conflictRetried = false;
    for (let attempt = 1; ; attempt++) {
      let outcome: CheckoutOutcome;
      try {
        outcome = await this.deps.start({ ...input, idempotencyKey: key });
      } catch {
        outcome = { kind: "unavailable" };
      }
      // The key was used with other input (should not happen): one new key.
      if (outcome.kind === "conflict" && !conflictRetried) {
        conflictRetried = true;
        key = this.freshKey(scope);
        continue;
      }
      // Invoice still being created: ask again with the same key.
      if (
        outcome.kind === "preparing" &&
        attempt < this.deps.preparingAttempts
      ) {
        const orderId = outcome.orderId;
        runInAction(() => {
          this.status = "preparing";
          this.orderId = orderId;
        });
        await this.deps.wait(this.deps.preparingDelayMs);
        continue;
      }
      runInAction(() => this.finish(scope, outcome));
      return;
    }
  }

  private freshKey(scope: string) {
    const key = this.deps.newKey();
    this.deps.keys.set(scope, key);
    return key;
  }

  private finish(scope: string, outcome: CheckoutOutcome) {
    this.status = "idle";
    switch (outcome.kind) {
      case "redirect":
        // The key stays: buying again returns this same order and page.
        this.status = "redirecting";
        this.orderId = outcome.orderId;
        this.deps.navigate(outcome.url);
        return;
      case "paid":
        this.status = "redirecting";
        this.deps.keys.clear(scope);
        this.deps.openOrder(outcome.orderId);
        return;
      case "preparing":
        this.problem = "slow";
        this.orderId = outcome.orderId;
        return;
      case "blocked":
        this.problem = "blocked";
        this.orderId = outcome.orderId;
        return;
      case "failed":
        this.deps.keys.clear(scope);
        this.problem = "failed";
        return;
      case "owned":
        this.deps.keys.clear(scope);
        this.problem = "owned";
        return;
      case "gone":
        this.deps.keys.clear(scope);
        this.problem = "gone";
        return;
      case "closed":
        this.problem = "closed";
        return;
      case "unauthorized":
        this.problem = "signedOut";
        return;
      case "conflict":
        this.deps.keys.clear(scope);
        this.problem = "unavailable";
        return;
      default:
        // Unknown result: the key stays so a retry reaches the same order.
        this.problem = "unavailable";
    }
  }
}

/** Keys in sessionStorage for 30 minutes; memory only if storage is blocked. */
export function sessionKeyVault(ttlMs = 30 * 60_000): KeyVault {
  const memory = new Map<string, { key: string; at: number }>();
  const name = (scope: string) => `og_checkout:${scope}`;
  const read = (scope: string) => {
    try {
      const raw = window.sessionStorage.getItem(name(scope));
      return raw ? (JSON.parse(raw) as { key: string; at: number }) : null;
    } catch {
      return memory.get(scope) ?? null;
    }
  };
  return {
    get(scope) {
      const entry = read(scope);
      if (!entry || typeof entry.key !== "string") return null;
      return Date.now() - entry.at < ttlMs ? entry.key : null;
    },
    set(scope, key) {
      const entry = { key, at: Date.now() };
      memory.set(scope, entry);
      try {
        window.sessionStorage.setItem(name(scope), JSON.stringify(entry));
      } catch {
        // Memory copy above is enough for this page.
      }
    },
    clear(scope) {
      memory.delete(scope);
      try {
        window.sessionStorage.removeItem(name(scope));
      } catch {
        // Nothing stored.
      }
    },
  };
}
