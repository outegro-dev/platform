import { createBackend } from "@outegro/bff/backend";
import { offerFor } from "@outegro/edu-engine";
import { type AccessOffer, accessOffer } from "./catalog";
import { env, platformUrls } from "./env";

const TTL_MS = 60_000;
let cached: { at: number; catalog: unknown } | null = null;

/**
 * The public catalog of payments (no token), kept for a minute: locked
 * chapters ask for it on every view. Null when payments is not configured
 * or does not answer; the reader then sees the invitation.
 */
async function loadCatalog(): Promise<unknown | null> {
  if (!env.PAYMENTS_API_URL) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.catalog;
  try {
    const catalog = await createBackend(env.PAYMENTS_API_URL)<unknown>(
      "/v1/catalog",
      { timeoutMs: 3000 },
    );
    cached = { at: Date.now(), catalog };
    return catalog;
  } catch {
    return null;
  }
}

/** How a reader gets access to a book, for a page at `path` of this app. */
export async function offerForBook(
  features: readonly string[],
  path: string,
): Promise<AccessOffer> {
  const catalog = await loadCatalog();
  return accessOffer(
    offerFor(catalog, features),
    new URL(path, env.APP_URL).toString(),
    platformUrls,
  );
}
