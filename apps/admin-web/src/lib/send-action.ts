/**
 * A command the browser could not deliver: offline before it left (nothing
 * was sent), or no answer from the console's server (the connection dropped,
 * the console restarted). The form keeps what the operator typed and offers
 * to send it again.
 */
export type Unsent = { status: "offline" | "failed"; at: number };

export const isUnsent = (value: { status: string }): value is Unsent =>
  value.status === "offline" || value.status === "failed";

/**
 * Sends a server action from a form. Offline it is not sent at all (it would
 * only fail after a network timeout); a request that throws instead of
 * answering becomes a state the form shows, never an error that replaces the
 * page (and the typed reason with it).
 */
export async function sendAction<R>(
  send: () => Promise<R>,
  online: () => boolean,
  now: () => number = Date.now,
): Promise<R | Unsent> {
  if (!online()) return { status: "offline", at: now() };
  try {
    return await send();
  } catch {
    // Still online: the server did not answer. Offline: the connection went.
    return { status: online() ? "failed" : "offline", at: now() };
  }
}
