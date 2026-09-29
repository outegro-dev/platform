import { wsTicketSchema } from "@outegro/contracts/battleship";
import { TicketError } from "./game-socket";

/**
 * One-time WebSocket ticket from the BFF (`POST /api/ws-ticket`), which asks
 * the backend with the session's access token. The token never reaches
 * this code; only the short-lived ticket does.
 */
export async function fetchTicket(
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher("/api/ws-ticket", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new TicketError("unavailable");
  }
  if (response.status === 401) throw new TicketError("unauthorized");
  if (!response.ok) throw new TicketError("unavailable");
  const body = wsTicketSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!body.success) throw new TicketError("unavailable");
  return body.data.ticket;
}
