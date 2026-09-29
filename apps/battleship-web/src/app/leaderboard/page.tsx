import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LeaderboardView } from "@/components/stats/leaderboard-view";
import { accessToken, loadLeaderboard } from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leaderboard");
  return { title: t("title") };
}

/** Public leaderboard: all time or this week, with your place when signed in. */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("leaderboard");
  const period = (await searchParams).period === "week" ? "week" : "all";
  const board = await loadLeaderboard(period);
  const signedIn = Boolean(await accessToken());
  return (
    <main id="main" className="app-main og-container">
      <header className="page-head">
        <p className="og-eyebrow">{t("eyebrow")}</p>
        <h1>
          {t("title")}
          <span className="og-accent">{t("titleAccent")}</span>
        </h1>
        <p>{t("lead")}</p>
      </header>
      <LeaderboardView
        initial={board.status === "ok" ? board.data : null}
        period={period}
        signedIn={signedIn}
      />
    </main>
  );
}
