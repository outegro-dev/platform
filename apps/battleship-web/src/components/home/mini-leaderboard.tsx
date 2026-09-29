import type { Leaderboard } from "@outegro/contracts/battleship";
import { Button } from "@outegro/ui/button";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Loaded } from "@/lib/api";
import { PremiumBadge } from "../chrome/player-chip";

/** Top five captains and your own place, rendered on the server. */
export async function MiniLeaderboard({
  board,
}: {
  board: Loaded<Leaderboard>;
}) {
  const t = await getTranslations("mini");
  const p = await getTranslations("player");
  const items = board.status === "ok" ? board.data.items.slice(0, 5) : [];
  const you = board.status === "ok" ? board.data.you : null;
  return (
    <section
      className="card"
      aria-labelledby="mini-title"
      data-testid="mini-leaderboard"
    >
      <div className="section-head">
        <h2 id="mini-title">{t("title")}</h2>
        <Button asChild variant="link" size="sm" className="px-0">
          <Link href="/leaderboard">
            {t("all")}
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
      {board.status !== "ok" ? (
        <p className="muted">{t("unavailable")}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ol className="rank-list">
          {items.map((item) => (
            <li key={`${item.rank}-${item.nickname}`} className="rank-row">
              <span className="medal" data-place={item.rank}>
                {item.rank}
              </span>
              <span className="rank-name">
                <span>{item.nickname}</span>
                {item.premium ? <PremiumBadge label={p("premium")} /> : null}
              </span>
              <span className="rank-rating">{item.rating}</span>
            </li>
          ))}
          {you ? (
            <li className="rank-row" data-you="">
              <span className="rank-num">
                {you.rank ? `#${you.rank}` : "—"}
              </span>
              <span className="rank-name">
                <span>{t("you")}</span>
              </span>
              <span className="rank-rating">{you.rating}</span>
            </li>
          ) : null}
        </ol>
      )}
      {you && you.rank === null ? (
        <p className="small muted">{t("unranked")}</p>
      ) : null}
    </section>
  );
}
