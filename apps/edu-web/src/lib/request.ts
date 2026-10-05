import { headers } from "next/headers";

/**
 * A router prefetch: rendered ahead of a click for the loading state, never
 * shown as a document. Prefetches skip what only a document needs (the
 * HTTP status of an unknown page) and the calls it would take for every
 * link on screen; the page itself still checks once it is opened.
 */
export async function isPrefetch(): Promise<boolean> {
  return (await headers()).has("next-router-prefetch");
}
