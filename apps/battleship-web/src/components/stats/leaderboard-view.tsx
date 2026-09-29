"use client";

import type { Leaderboard } from "@outegro/contracts/battleship";
import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon, SignInIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Period } from "@/game/stores/stats-store";
import { formatDate, formatPercent, formatSigned } from "@/lib/format";
import { signInHref } from "@/lib/routes";
import { PremiumBadge } from "../chrome/player-chip";
import { useRoot } from "../providers";

const SKELETON_ROWS = 8;

/**
 * All-time and weekly boards as tabs. The first board comes from the
 * server; switching loads the other one once, with fixed-height skeleton
 * rows meanwhile.
 */
export const LeaderboardView = observer(function LeaderboardView({
  initial,
  period,
  signedIn,
}: {
  initial: Leaderboard | null;
  period: Period;
  signedIn: boolean;
}) {
  const root = useRoot();
  const [stats] = useState(() => root.createStats({ period, board: initial }));
  const t = useTranslations("leaderboard");
  const p = useTranslations("player");
  const locale = useLocale();
  const board = stats.board;
  const loading = stats.boardState === "loading" && !board;
  const failed = !board && (stats.boardState === "error" || initial === null);

  const select = (next: Period) => {
    void stats.selectPeriod(next);
    const url = new URL(window.location.href);
    url.searchParams.set("period", next);
    window.history.replaceState(null, "", url);
  };

  const periods: Period[] = ["all", "week"];
  const you = board?.you ?? null;
  const week = stats.period === "week";

  return (
    <div className="lb-layout">
      <section className="card" aria-labelledby="lb-title">
        <h2 id="lb-title" className="sr-only">
          {t("title")}
        </h2>
        <div className="lb-controls">
          <div className="segmented" role="tablist" aria-label={t("tabs")}>
            {periods.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                id={`tab-${item}`}
                aria-selected={stats.period === item}
                aria-controls="lb-panel"
                tabIndex={stats.period === item ? 0 : -1}
                className="segment"
                onClick={() => select(item)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  const next = item === "all" ? "week" : "all";
                  select(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }}
              >
                {t(item)}
              </button>
            ))}
          </div>
          <span className="small muted">
            {week && board?.since
              ? t("since", { date: formatDate(board.since, locale) })
              : " "}
          </span>
        </div>
        <div
          id="lb-panel"
          role="tabpanel"
          aria-labelledby={`tab-${stats.period}`}
          aria-busy={loading || undefined}
          className="board-table-wrap"
        >
          {failed ? (
            <div className="notice-inline">
              <p className="status-line" data-tone="error">
                {t("error")}
              </p>
              <Button
                variant="outline"
                onClick={() => void stats.reloadBoard()}
              >
                <ArrowClockwiseIcon />
                {t("retry")}
              </Button>
            </div>
          ) : (
            <table className="lb-table" data-testid="leaderboard-table">
              <thead>
                <tr>
                  <th scope="col">{t("rank")}</th>
                  <th scope="col">{t("player")}</th>
                  <th scope="col" className="num">
                    {t("rating")}
                  </th>
                  <th scope="col" className="num lb-hide-sm">
                    {t("wins")}
                  </th>
                  <th scope="col" className="num lb-hide-sm">
                    {t("matches")}
                  </th>
                  <th scope="col" className="num lb-hide-sm">
                    {t("winRate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading || !board ? (
                  Array.from({ length: SKELETON_ROWS }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows
                    <tr key={i} className="lb-skeleton">
                      <td>
                        <span className="skeleton-bar" style={{ width: 24 }} />
                      </td>
                      <td>
                        <span className="skeleton-bar" style={{ width: 140 }} />
                      </td>
                      <td className="num">
                        <span
                          className="skeleton-bar"
                          style={{ width: 44, marginInlineStart: "auto" }}
                        />
                      </td>
                      <td className="num lb-hide-sm">
                        <span
                          className="skeleton-bar"
                          style={{ width: 24, marginInlineStart: "auto" }}
                        />
                      </td>
                      <td className="num lb-hide-sm">
                        <span
                          className="skeleton-bar"
                          style={{ width: 24, marginInlineStart: "auto" }}
                        />
                      </td>
                      <td className="num lb-hide-sm">
                        <span
                          className="skeleton-bar"
                          style={{ width: 32, marginInlineStart: "auto" }}
                        />
                      </td>
                    </tr>
                  ))
                ) : board.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      {t("empty")}
                    </td>
                  </tr>
                ) : (
                  board.items.map((item) => (
                    <tr key={`${item.rank}-${item.nickname}`}>
                      <td>
                        <span className="medal" data-place={item.rank}>
                          {item.rank}
                        </span>
                      </td>
                      <td>
                        <span className="rank-name">
                          <span>{item.nickname}</span>
                          {item.premium ? (
                            <PremiumBadge label={p("premium")} />
                          ) : null}
                        </span>
                      </td>
                      <td className="num">
                        <strong>{item.rating}</strong>
                        {week && item.gained !== undefined ? (
                          <span
                            className="gained"
                            data-sign={item.gained >= 0 ? "up" : "down"}
                          >
                            {t("gained", {
                              points: formatSigned(item.gained, locale),
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td className="num lb-hide-sm">{item.wins}</td>
                      <td className="num lb-hide-sm">{item.matches}</td>
                      <td className="num lb-hide-sm">
                        {formatPercent(
                          item.matches ? item.wins / item.matches : null,
                          locale,
                        ) ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
      <aside
        className="card you-card"
        aria-labelledby="you-title"
        data-testid="your-place"
      >
        <h2 id="you-title" className="og-eyebrow">
          {t("yourPlace")}
        </h2>
        {!signedIn ? (
          <>
            <p>{t("signInLead")}</p>
            <Button asChild>
              <a href={signInHref(`/leaderboard?period=${stats.period}`)}>
                <SignInIcon />
                {t("signInButton")}
              </a>
            </Button>
          </>
        ) : you?.rank ? (
          <>
            <p className="you-rank">{t("yourRank", { rank: you.rank })}</p>
            <p className="rating-meta">
              <span>
                {t("rating")} <strong className="tabular">{you.rating}</strong>
              </span>
              {week && you.gained !== undefined ? (
                <span
                  className="gained"
                  data-sign={you.gained >= 0 ? "up" : "down"}
                >
                  {t("gained", { points: formatSigned(you.gained, locale) })}
                </span>
              ) : null}
            </p>
            <p className="small muted tabular">
              {t("wins")} {you.wins} · {t("matches")} {you.matches}
            </p>
          </>
        ) : (
          <>
            <p className="you-rank muted">—</p>
            <p>{t("unranked")}</p>
            <p className="small muted">{t("unrankedHint")}</p>
          </>
        )}
      </aside>
    </div>
  );
});
