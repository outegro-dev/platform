import type {
  CosmeticSlot,
  Cosmetics,
  PlayerProfile,
} from "@outegro/contracts/battleship";
import {
  type IReactionDisposer,
  makeAutoObservable,
  reaction,
  runInAction,
} from "mobx";
import {
  type Catalog,
  type CatalogProduct,
  type CheckoutOutcome,
  type CheckoutRequest,
  type Currency,
  priceIn,
} from "@/lib/catalog";
import { realTimers, type Timers } from "../transport/timers";
import type { SessionStore } from "./session-store";

export type EquipResult =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; reason: "locked" | "unavailable" | "unauthorized" };

/** Server calls the shop needs (server actions and `/api/me` in the app). */
export interface ShopApi {
  startCheckout(request: CheckoutRequest): Promise<CheckoutOutcome>;
  equip(change: Partial<Cosmetics>): Promise<EquipResult>;
  fetchProfile(): Promise<PlayerProfile | null>;
}

/**
 * - `starting`: asking payments for a checkout;
 * - `preparing`: the order exists, the payment page is being created;
 * - `redirecting`: leaving for the provider's page;
 * - `processing`: back from the provider, waiting for the grant;
 * - `success`: the feature arrived;
 * - `slow`: no grant after the wait; it will still apply on its own.
 */
export type ShopPhase =
  | "idle"
  | "starting"
  | "preparing"
  | "redirecting"
  | "processing"
  | "success"
  | "slow";

export type ShopError =
  | Extract<CheckoutOutcome, { kind: "error" }>["reason"]
  | "owned";

export type ShopDeps = {
  session: SessionStore;
  api: ShopApi;
  navigate: (url: string) => void;
  timers?: Timers;
  /** A fresh Idempotency-Key per purchase. */
  newReference?: () => string;
  pollMs?: number;
  maxWaitMs?: number;
  prepareDelayMs?: number;
  prepareAttempts?: number;
};

/**
 * Purchases and cosmetics. A purchase keeps one Idempotency-Key through its
 * retries (the payment page may take a moment to be created). After the
 * provider sends the player back, the shop waits for the feature:
 * `player.updated` over the socket (which refreshes the profile) or polling
 * `/api/me` every 3 s for up to 2 min.
 */
export class ShopStore {
  catalog: Catalog;
  currency: Currency;
  phase: ShopPhase = "idle";
  buying: string | null = null;
  error: ShopError | null = null;
  awaiting: string | null = null;
  equipping: CosmeticSlot | null = null;
  equipError: Extract<EquipResult, { ok: false }>["reason"] | null = null;
  private pollTimer: unknown = null;
  private waitTimer: unknown = null;
  private watch: IReactionDisposer | null = null;
  private readonly timers: Timers;

  constructor(
    private readonly deps: ShopDeps,
    initial: { catalog: Catalog; currency: Currency },
  ) {
    this.catalog = initial.catalog;
    this.currency = initial.currency;
    this.timers = deps.timers ?? realTimers;
    makeAutoObservable<
      ShopStore,
      "deps" | "pollTimer" | "waitTimer" | "watch" | "timers"
    >(
      this,
      {
        deps: false,
        pollTimer: false,
        waitTimer: false,
        watch: false,
        timers: false,
      },
      { autoBind: true },
    );
  }

  get products(): CatalogProduct[] {
    return this.catalog.products;
  }

  /** Currencies at least one product is priced in. */
  get currencies(): Currency[] {
    const found = new Set<Currency>();
    for (const product of this.products)
      for (const price of product.prices) found.add(price.money.currency);
    return (["RUB", "USD", "EUR"] as const).filter((c) => found.has(c));
  }

  get canBuy(): boolean {
    return (
      this.catalog.status === "ok" &&
      this.catalog.checkoutEnabled &&
      this.deps.session.signedIn
    );
  }

  get busy(): boolean {
    return (
      this.phase === "starting" ||
      this.phase === "preparing" ||
      this.phase === "redirecting" ||
      this.phase === "processing"
    );
  }

  productFor(feature: string): CatalogProduct | null {
    return this.products.find((product) => product.feature === feature) ?? null;
  }

  priceOf(product: CatalogProduct) {
    return priceIn(product, this.currency);
  }

  owns(feature: string): boolean {
    return this.deps.session.hasFeature(feature);
  }

  setCurrency(currency: Currency): void {
    this.currency = currency;
  }

  async buy(product: CatalogProduct): Promise<void> {
    if (this.busy || !this.canBuy || this.owns(product.feature)) return;
    const price = this.priceOf(product);
    if (!price) return;
    const request: CheckoutRequest = {
      productKey: product.key,
      currency: price.money.currency,
      feature: product.feature,
      reference: (this.deps.newReference ?? newReference)(),
    };
    this.phase = "starting";
    this.buying = product.key;
    this.error = null;
    const attempts = this.deps.prepareAttempts ?? 6;
    for (let attempt = 1; ; attempt++) {
      let outcome: CheckoutOutcome;
      try {
        outcome = await this.deps.api.startCheckout(request);
      } catch {
        outcome = { kind: "error", reason: "unavailable" };
      }
      if (outcome.kind === "preparing" && attempt < attempts) {
        runInAction(() => {
          this.phase = "preparing";
        });
        await this.wait(this.deps.prepareDelayMs ?? 1500);
        continue;
      }
      this.settle(
        outcome.kind === "preparing"
          ? { kind: "error", reason: "unavailable" }
          : outcome,
        product,
      );
      return;
    }
  }

  /** Back from checkout: wait until the feature shows up. */
  awaitFeature(feature: string): void {
    this.stopWaiting();
    this.awaiting = feature;
    if (this.owns(feature)) {
      this.phase = "success";
      return;
    }
    this.phase = "processing";
    this.watch = reaction(
      () => this.owns(feature),
      (owned) => {
        if (owned) this.succeed();
      },
    );
    this.pollTimer = this.timers.setInterval(
      () => void this.poll(),
      this.deps.pollMs ?? 3000,
    );
    this.waitTimer = this.timers.setTimeout(() => {
      runInAction(() => {
        if (this.phase === "processing") this.phase = "slow";
      });
      this.stopTimers();
    }, this.deps.maxWaitMs ?? 120_000);
  }

  dismiss(): void {
    this.stopWaiting();
    this.phase = "idle";
    this.awaiting = null;
    this.error = null;
  }

  async equip<S extends CosmeticSlot>(
    slot: S,
    item: Cosmetics[S],
  ): Promise<void> {
    if (this.equipping) return;
    this.equipping = slot;
    this.equipError = null;
    let result: EquipResult;
    try {
      result = await this.deps.api.equip({
        [slot]: item,
      } as Partial<Cosmetics>);
    } catch {
      result = { ok: false, reason: "unavailable" };
    }
    runInAction(() => {
      this.equipping = null;
      if (result.ok) this.deps.session.setProfile(result.profile);
      else this.equipError = result.reason;
    });
  }

  dispose(): void {
    this.stopWaiting();
  }

  private settle(outcome: CheckoutOutcome, product: CatalogProduct): void {
    if (outcome.kind === "redirect") {
      this.phase = "redirecting";
      this.deps.navigate(outcome.url);
      return;
    }
    this.buying = null;
    if (outcome.kind === "pending") {
      this.awaitFeature(product.feature);
    } else if (outcome.kind === "owned") {
      this.phase = "idle";
      this.error = "owned";
      void this.deps.session.refreshProfile();
    } else if (outcome.kind === "error") {
      this.phase = "idle";
      this.error = outcome.reason;
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.setTimeout(resolve, ms);
    });
  }

  private async poll(): Promise<void> {
    const profile = await this.deps.api.fetchProfile().catch(() => null);
    if (profile) runInAction(() => this.deps.session.setProfile(profile));
  }

  private succeed(): void {
    this.stopWaiting();
    this.phase = "success";
  }

  private stopTimers(): void {
    if (this.pollTimer !== null) this.timers.clearInterval(this.pollTimer);
    if (this.waitTimer !== null) this.timers.clearTimeout(this.waitTimer);
    this.pollTimer = null;
    this.waitTimer = null;
  }

  private stopWaiting(): void {
    this.stopTimers();
    this.watch?.();
    this.watch = null;
  }
}

function newReference(): string {
  return `bs-${globalThis.crypto.randomUUID()}`;
}
