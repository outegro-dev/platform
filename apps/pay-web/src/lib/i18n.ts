import type { Localized } from "./payments/model";
import { fallbackServiceName } from "./services";

/** The product's own text in the page language, the other one if empty. */
export function pick(text: Localized, locale: string) {
  return locale === "ru" ? text.ru || text.en : text.en || text.ru;
}

export type ServiceTranslator = {
  (key: string): string;
  has(key: string): boolean;
};

/** "Battleship" / "Морской бой"; an app we have no name for keeps its key. */
export function serviceName(t: ServiceTranslator, service: string) {
  return t.has(service) ? t(service) : fallbackServiceName(service);
}
