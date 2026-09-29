import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { type Formatters, formatters } from "./format";
import { type ServiceTranslator, serviceName } from "./i18n";

/** Money and dates in the request's language and the viewer's time zone. */
export async function getFormat(): Promise<Formatters> {
  return formatters(await getLocale(), (await getTimeZone()) ?? "UTC");
}

/** Translated service names for server components. */
export async function getServiceName() {
  const t = (await getTranslations("services")) as unknown as ServiceTranslator;
  return (service: string) => serviceName(t, service);
}
