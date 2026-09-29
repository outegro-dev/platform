/**
 * outegro.dev apps that sell something, keyed by the payments `service`.
 * Names are translated in messages (`services.<key>`); a service missing
 * here still shows, only without a link back to it.
 */
const registry: Record<string, { url: string; shopPath: string }> = {
  battleship: { url: "https://battleship.outegro.dev", shopPath: "/shop" },
};

export type ServiceLink = { home: string; shop: string };

export function serviceLink(
  service: string | null | undefined,
): ServiceLink | null {
  const entry = service ? registry[service] : undefined;
  if (!entry) return null;
  return {
    home: entry.url,
    shop: new URL(entry.shopPath, entry.url).toString(),
  };
}

/** "battleship" → "Battleship" when no translation exists. */
export function fallbackServiceName(service: string) {
  const words = service.replace(/[-_.]+/g, " ").trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : service;
}
