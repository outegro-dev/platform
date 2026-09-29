import type { Currency } from "./money.js";
import type { Periodicity } from "./periods.js";

export type LocalizedText = { en: string; ru: string };
export type ProductKind = "subscription" | "one_time";

export type CatalogProduct = {
  /** Our product key; clients buy by it. */
  key: string;
  /** Grant target (service / feature) the purchase opens. */
  service: string;
  feature: string;
  kind: ProductKind;
  periodicity: Periodicity;
  provider: "lava";
  providerOfferId: string;
  /** Days of access after a paid subscription period ends. */
  graceDays: number;
  title: LocalizedText;
  description: LocalizedText;
  /** Decimal strings per currency, as configured in the Lava offer. */
  prices: Partial<Record<Currency, string>>;
};

/**
 * The sellable catalog (chapter 16.4, owner decision 29.09.2026). Synced
 * into `products`/`prices` at startup: a changed price becomes a new
 * immutable price version, past orders keep their snapshot.
 */
export const catalog: readonly CatalogProduct[] = [
  {
    key: "battleship-premium",
    service: "battleship",
    feature: "premium",
    kind: "subscription",
    periodicity: "MONTHLY",
    provider: "lava",
    providerOfferId: "e343b6c1-af82-471a-90ac-e6ecbcaf292c",
    graceDays: 3,
    title: { en: "Battleship Premium", ru: "Морской бой Premium" },
    description: {
      en: "Hard and expert bots, extended statistics, every skin and a leaderboard badge while the subscription lasts.",
      ru: "Сложный бот и эксперт, расширенная статистика, все скины и значок в лидерборде на время подписки.",
    },
    prices: { RUB: "50", USD: "0.59", EUR: "0.52" },
  },
  {
    key: "battleship-silver-fleet",
    service: "battleship",
    feature: "cosmetics.silver-fleet",
    kind: "one_time",
    periodicity: "ONE_TIME",
    provider: "lava",
    providerOfferId: "3d11791f-6084-4a99-9102-4b0c362cfee8",
    graceDays: 0,
    title: { en: "Silver Fleet", ru: "Серебряный флот" },
    description: {
      en: "Silver ships, the “shards” hit effect and the “Night sea” board theme, forever.",
      ru: "Серебряные корабли, эффект попадания «осколки» и тема поля «Ночное море», навсегда.",
    },
    prices: { RUB: "50", USD: "0.59", EUR: "0.52" },
  },
];
