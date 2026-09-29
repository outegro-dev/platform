import { BackendError } from "@outegro/bff/backend";
import { wsTicketSchema } from "@outegro/contracts/battleship";
import { accessToken, battleshipApi } from "@/lib/api";
import { fromThisApp } from "@/lib/sso";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * One-time WebSocket ticket (§16.6): the BFF asks the backend with the
 * session's access token, the browser only sees the 30-second ticket.
 */
export async function POST(request: Request) {
  if (!fromThisApp(request)) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: noStore },
    );
  }
  const token = await accessToken();
  if (!token) {
    return Response.json(
      { error: "signed_out" },
      { status: 401, headers: noStore },
    );
  }
  try {
    const raw = await battleshipApi<unknown>("/v1/ws-tickets", {
      method: "POST",
      accessToken: token,
      body: {},
    });
    const ticket = wsTicketSchema.parse(raw);
    return Response.json(ticket, { headers: noStore });
  } catch (error) {
    if (error instanceof BackendError && error.status === 401) {
      return Response.json(
        { error: "signed_out" },
        { status: 401, headers: noStore },
      );
    }
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: noStore },
    );
  }
}
