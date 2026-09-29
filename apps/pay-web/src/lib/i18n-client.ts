import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { type Formatters, formatters } from "./format";
import { type ServiceTranslator, serviceName } from "./i18n";

/** Money and dates in the page language and the viewer's time zone. */
export function useFormat(): Formatters {
  return formatters(useLocale(), useTimeZone() ?? "UTC");
}

/** Translated service names for client components. */
export function useServiceName() {
  const t = useTranslations("services") as unknown as ServiceTranslator;
  return (service: string) => serviceName(t, service);
}
