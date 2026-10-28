import { accessToken, loadWalletBalance } from "@/lib/api";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** The player's grumbles from the wallet, when the game socket could not say. */
export async function GET() {
  if (!(await accessToken()))
    return Response.json(
      { error: "signed_out" },
      { status: 401, headers: noStore },
    );
  return Response.json(
    { balance: await loadWalletBalance() },
    { headers: noStore },
  );
}
