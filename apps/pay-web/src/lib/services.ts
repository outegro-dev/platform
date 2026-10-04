import {
  type PlatformApp,
  type PlatformUrls,
  platformHref,
} from "@outegro/ui/lib/platform";

/**
 * outegro.dev apps that sell something, keyed by the payments `service`:
 * the platform app it is and where its shop is. Names are translated in
 * messages (`services.<key>`); a service missing here still shows, only
 * without a link back to it. Addresses come from the app's configuration.
 */
const registry: Record<string, { app: PlatformApp; shopPath: string }> = {
  battleship: { app: "battleship", shopPath: "/shop" },
  // No shop page of its own: a purchase leads to the textbooks.
  edu: { app: "edu", shopPath: "/" },
};

export type ServiceLink = { home: string; shop: string };

export function serviceLink(
  service: string | null | undefined,
  urls: PlatformUrls,
): ServiceLink | null {
  // Own keys only: a service called "constructor" is just an unknown one.
  const entry =
    service && Object.hasOwn(registry, service) ? registry[service] : undefined;
  if (!entry) return null;
  return {
    home: platformHref(urls, entry.app, "/"),
    shop: platformHref(urls, entry.app, entry.shopPath),
  };
}

/** "battleship" → "Battleship" when no translation exists. */
export function fallbackServiceName(service: string) {
  const words = service.replace(/[-_.]+/g, " ").trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : service;
}
