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
  type CheckoutResult,
  type Currency,
  type OrderStatus,
  priceIn,
} from "@/lib/catalog";
import { realTimers, type Timers } from "../transport/timers";
import type { SessionStore } from "./session-store";

export type EquipResult =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; reason: "locked" | "unavailable" | "unauthorized" };

/** Server calls the shop needs (server actions and BFF routes in the app). */
export interface ShopApi {
  startCheckout(request: CheckoutRequest): Promise<CheckoutOutcome>;
  orderStatus(orderId: string): Promise<OrderStatus | null>;
  equip(change: Partial<Cosmetics>): Promise<EquipResult>;
  fetchProfile(): Promise<PlayerProfile | null>;
}

export type PendingPurchase = { productKey: string; feature: string };

/**
 * The purchase in flight while the buyer is on the provider's page
 * (sessionStorage in the browser): after the return it tells the shop
 * which feature to wait for.
 */
export interface PendingPurchases {
  save(purchase: PendingPurchase): void;
  /** Reads and forgets it. */
  take(): PendingPurchase | null;
}

/**
 * - `starting`: asking payments for a checkout;
 * - `preparing`: the order exists, the payment page is being created;
 * - `redirecting`: leaving for the provider's page;
 * - `processing`: back from the provider, waiting for the grant;
 * - `success`: the feature arrived;
 * - `slow`: no grant after the wait; it will still apply on its own;
 * - `cancelled`: the buyer cancelled on the provider's page;
 * - `failed`: the payment did not go through.
 */
export type ShopPhase =
  | "idle"
  | "starting"
  | "preparing"
  | "redirecting"
  | "processing"
  | "success"
  | "slow"
  | "cancelled"
  | "failed";

export type ShopError =
  | Extract<CheckoutOutcome, { kind: "error" }>["reason"]
  | "owned";

export type ShopDeps = {
  session: SessionStore;
  api: ShopApi;
  navigate: (url: string) => void;
  pending?: PendingPurchases | null;
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
 * retries (the payment page may take a moment to be created). Back from the
 * provider, `result` is only a hint: the shop shows "processing" until the
 * feature arrives (`player.updated`, or `/api/me` polled every 3 s for up
 * to 2 min) or the order is reported failed.
 */
export class ShopStore {
  catalog: Catalog;
  currency: Currency;
  phase: ShopPhase = "idle";
  buying: string | null = null;
  error: ShopError | null = null;
  /** The feature the shop waits for, when known. */
  awaiting: string | null = null;
  orderId: string | null = null;
  equipping: CosmeticSlot | null = null;
  equipError: Extract<EquipResult, { ok: false }>["reason"] | null = null;
  private pollTimer: unknown = null;
  private waitTimer: unknown = null;
  private watch: IReactionDisposer | null = null;
  private readonly timers: Timers;

  constructor(
    private readonly deps: ShopDeps,
    initial: {
      catalog: Catalog;
      currency: Currency;
      /** Back from the provider: render the right state at once, then call returnFromCheckout(). */
      returned?: { orderId: string; result: CheckoutResult | null } | null;
    },
  ) {
    this.catalog = initial.catalog;
    this.currency = initial.currency;
    this.timers = deps.timers ?? realTimers;
    if (initial.returned) {
      this.orderId = initial.returned.orderId;
      this.phase =
        initial.returned.result === "cancel" ? "cancelled" : "processing";
    }
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

  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
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

  /**
   * Back from the provider's page with `?orderId=…&result=…`. Cancel is
   * final; anything else waits for the grant, and the order's status can
   * still turn it into a failure.
   */
  returnFromCheckout(orderId: string, result: CheckoutResult | null): void {
    const purchase = this.deps.pending?.take() ?? null;
    this.orderId = orderId;
    this.awaiting = purchase?.feature ?? null;
    if (result === "cancel") {
      this.stopWaiting();
      this.phase = "cancelled";
      return;
    }
    this.startWaiting();
    if (result === "failure") void this.checkOrder({ failUnlessPaid: true });
  }

  /** Waits for a feature (checkout accepted without a page to visit). */
  awaitFeature(feature: string): void {
    this.awaiting = feature;
    this.orderId = null;
    this.startWaiting();
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
      this.deps.pending?.save({
        productKey: product.key,
        feature: product.feature,
      });
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

  private startWaiting(): void {
    this.stopWaiting();
    if (this.awaiting && this.owns(this.awaiting)) {
      this.phase = "success";
      return;
    }
    this.phase = "processing";
    this.watchFeature();
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

  private watchFeature(): void {
    this.watch?.();
    this.watch = null;
    const feature = this.awaiting;
    if (!feature) return;
    this.watch = reaction(
      () => this.owns(feature),
      (owned) => {
        if (owned) this.succeed();
      },
    );
  }

  private async poll(): Promise<void> {
    const profile = await this.deps.api.fetchProfile().catch(() => null);
    if (profile) runInAction(() => this.deps.session.setProfile(profile));
    await this.checkOrder({ failUnlessPaid: false });
  }

  private async checkOrder(options: {
    failUnlessPaid: boolean;
  }): Promise<void> {
    if (!this.orderId) return;
    const order = await this.deps.api
      .orderStatus(this.orderId)
      .catch(() => null);
    runInAction(() => {
      if (this.phase !== "processing" && this.phase !== "slow") return;
      if (order?.feature && !this.awaiting) {
        this.awaiting = order.feature;
        if (this.owns(order.feature)) {
          this.succeed();
          return;
        }
        this.watchFeature();
      }
      if (
        order?.status === "failed" ||
        (options.failUnlessPaid && order?.status !== "paid")
      ) {
        this.stopWaiting();
        this.phase = "failed";
      } else if (order?.status === "paid" && !this.awaiting) {
        // Paid, but we do not know what for: the refreshed profile shows it.
        this.succeed();
      }
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.setTimeout(resolve, ms);
    });
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

/** sessionStorage-backed pending purchase (per tab, survives the provider redirect). */
export function sessionPendingPurchases(): PendingPurchases | null {
  const key = "bs:pending-purchase";
  try {
    const storage = window.sessionStorage;
    return {
      save(purchase) {
        try {
          storage.setItem(key, JSON.stringify(purchase));
        } catch {
          // Blocked storage: the order status still names the feature.
        }
      },
      take() {
        try {
          const raw = storage.getItem(key);
          storage.removeItem(key);
          const value = raw
            ? (JSON.parse(raw) as Partial<PendingPurchase>)
            : null;
          return typeof value?.productKey === "string" &&
            typeof value.feature === "string"
            ? { productKey: value.productKey, feature: value.feature }
            : null;
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}
