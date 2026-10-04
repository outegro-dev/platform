import { eduService } from "@outegro/contracts/edu";

/*
 * Which product of the public Payments catalog unlocks a book. Payments
 * sells nothing for the books until the owner sets a price; the day an
 * active product of service "edu" with one of the book's features appears,
 * readers are offered it. The catalog is read leniently: products of other
 * services, unknown periodicities or fields never break it, and a malformed
 * entry is skipped.
 */

const productKey = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type Product = { key: string; service: string; feature: string };

function productOf(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const { key, service, feature, active } = raw as Record<string, unknown>;
  if (typeof key !== "string" || !productKey.test(key)) return null;
  if (typeof service !== "string" || typeof feature !== "string") return null;
  // Payments lists active products only; a flag, if ever sent, is honoured.
  if (active !== undefined && active !== true) return null;
  return { key, service, feature };
}

/**
 * The key of the catalog product that unlocks a book with one of
 * `features` (the book's own order decides between several), or null.
 */
export function offerFor(
  catalog: unknown,
  features: readonly string[],
): string | null {
  if (!catalog || typeof catalog !== "object") return null;
  const products = (catalog as { products?: unknown }).products;
  if (!Array.isArray(products)) return null;
  let best: { key: string; rank: number } | null = null;
  for (const raw of products) {
    const product = productOf(raw);
    if (!product || product.service !== eduService) continue;
    const rank = features.indexOf(product.feature);
    if (rank === -1) continue;
    if (!best || rank < best.rank) best = { key: product.key, rank };
  }
  return best?.key ?? null;
}
