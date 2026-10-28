import { RouletteScreen } from "@/components/game/roulette-screen";
import { SignedOutScreen } from "@/components/game/signed-out-screen";
import { accessToken, loadHistory, loadMe } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The game for a player, the results and a way in for everyone else. */
export default async function HomePage() {
  const token = await accessToken();
  const me = token ? await loadMe() : null;
  const signedIn = Boolean(token) && me?.status !== "signed-out";
  if (signedIn)
    return (
      <main id="main" className="app-main og-container">
        <RouletteScreen />
      </main>
    );
  const history = await loadHistory(20);
  return (
    <main id="main" className="app-main og-container">
      <SignedOutScreen
        history={history.status === "ok" ? history.data : null}
      />
    </main>
  );
}
