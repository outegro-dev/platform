import type { CatalogProduct } from "./catalog.js";
import type { Currency } from "./money.js";

/**
 * A pack of grumbles as the owner sets it up (GRUMBLE-PACKS, phase 2):
 * how many grumbles, its own Lava offer, and the offer's prices.
 */
export type PackConfig = {
  key: string;
  grumbles: number;
  offerId: string;
  prices: Partial<Record<Currency, string>>;
};

const russianForms: Record<string, string> = {
  one: "грамблс",
  few: "грамблса",
  many: "грамблсов",
};
const russianPlural = new Intl.PluralRules("ru");

/** "1,000 grumbles" and "1 000 грамблсов". */
export function packTitle(grumbles: number) {
  const en = `${new Intl.NumberFormat("en-US").format(grumbles)} ${
    grumbles === 1 ? "grumble" : "grumbles"
  }`;
  const form =
    russianForms[russianPlural.select(grumbles)] ?? russianForms.many;
  // Russian groups thousands with a space; a plain one, as everywhere else.
  const number = new Intl.NumberFormat("ru-RU")
    .format(grumbles)
    .replace(/\s/g, " ");
  return { en, ru: `${number} ${form}` };
}

/**
 * The packs as catalog products: one-time purchases of the wallet that
 * open no access; settlement hands them to the wallet instead of a grant.
 */
export function packProducts(packs: readonly PackConfig[]): CatalogProduct[] {
  return packs.map((pack) => ({
    key: pack.key,
    service: "wallet",
    feature: "grumbles",
    kind: "grumble_pack",
    periodicity: "ONE_TIME",
    provider: "lava",
    providerOfferId: pack.offerId,
    graceDays: 0,
    title: packTitle(pack.grumbles),
    description: {
      en: "Grumbles go to your outegro.dev wallet and pay for what is sold for grumbles. A one-time purchase.",
      ru: "Грамблсы зачисляются на кошелёк outegro.dev и тратятся на то, что продаётся за грамблсы. Разовая покупка.",
    },
    prices: pack.prices,
    grumbles: pack.grumbles,
  }));
}
