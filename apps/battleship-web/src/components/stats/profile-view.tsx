"use client";

import type { PlayerStats } from "@outegro/contracts/battleship";
import { Button } from "@outegro/ui/button";
import {
  ArrowClockwiseIcon,
  LockSimpleIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type CSSProperties, useState } from "react";
import { botLevels } from "@/game/stores/lobby-store";
import type { HistoryPage, MatchSummary } from "@/game/stores/stats-store";
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  formatSigned,
} from "@/lib/format";
import { initialOf, PremiumBadge } from "../chrome/player-chip";
import { useRoot } from "../providers";
import { AccountCard, Settings } from "./settings";

/** A fixed sample, shown blurred behind the Premium lock. */
const SAMPLE_HEATMAP = Array.from({ length: 10 }, (_, y) =>
  Array.from({ length: 10 }, (_, x) => {
    const centre = Math.hypot(x - 4.5, y - 4.5);
    return Math.max(0, Math.round(9 - centre * 1.6 + ((x * 7 + y * 3) % 4)));
  }),
);
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

function Heatmap({ grid, label }: { grid: number[][]; label: string }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="heatmap" role="img" aria-label={label}>
      <span />
      {LETTERS.map((letter) => (
        <span key={letter} className="heatmap-label">
          {letter}
        </span>
      ))}
      {grid.map((row, y) => (
        <HeatRow
          // biome-ignore lint/suspicious/noArrayIndexKey: board rows
          key={y}
          y={y}
          row={row}
          max={max}
        />
      ))}
    </div>
  );
}

function HeatRow({ y, row, max }: { y: number; row: number[]; max: number }) {
  return (
    <>
      <span className="heatmap-label">{y + 1}</span>
      {row.map((count, x) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: board cells
          key={x}
          className="heatmap-cell"
          style={{ "--heat": (count / max).toFixed(3) } as CSSProperties}
        />
      ))}
    </>
  );
}

function StatsCard({ stats }: { stats: PlayerStats }) {
  const t = useTranslations("profile.stats");
  const locale = useLocale();
  const none = t("none");
  const items = [
    { key: "matches", value: formatNumber(stats.matches, locale) },
    { key: "wins", value: formatNumber(stats.wins, locale) },
    { key: "winRate", value: formatPercent(stats.winRate, locale) ?? none },
    { key: "accuracy", value: formatPercent(stats.accuracy, locale) ?? none },
    {
      key: "streak",
      value: formatNumber(stats.longestStreak, locale),
      sub: t("currentStreak", { count: stats.currentStreak }),
    },
    {
      key: "avgMoves",
      value:
        stats.averageMovesToWin === null
          ? none
          : formatNumber(stats.averageMovesToWin, locale, 1),
    },
  ] as const;
  return (
    <dl className="stat-grid" data-testid="stat-cards">
      {items.map((item) => (
        <div key={item.key} className="stat">
          <dt>{t(item.key)}</dt>
          <dd>
            {item.value}
            {"sub" in item ? (
              <span className="stat-sub"> · {item.sub}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BotWins({ stats }: { stats: PlayerStats }) {
  const t = useTranslations("profile");
  const levels = useTranslations("modes.levels");
  const max = Math.max(
    1,
    ...botLevels.map((level) => stats.botWins[level] ?? 0),
  );
  return (
    <section className="card" aria-labelledby="bots-title">
      <h2 id="bots-title">{t("bots")}</h2>
      <ul className="bot-bars">
        {botLevels.map((level) => {
          const wins = stats.botWins[level] ?? 0;
          return (
            <li key={level} className="bot-bar">
              <span>{levels(level)}</span>
              <span className="bot-bar-track" aria-hidden="true">
                <span
                  className="bot-bar-fill"
                  style={
                    { "--share": (wins / max).toFixed(3) } as CSSProperties
                  }
                />
              </span>
              <span className="bot-bar-count">{wins}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HeatmapCard({ heatmap }: { heatmap: number[][] | null }) {
  const t = useTranslations("profile");
  const upsell = useTranslations("upsell");
  const empty = Boolean(heatmap?.flat().every((count) => count === 0));
  return (
    <section
      className="card"
      aria-labelledby="heat-title"
      data-testid="heatmap-card"
    >
      <div className="card-head">
        <div>
          <h2 id="heat-title">{t("heatmap")}</h2>
          <p className="small muted">{t("heatmapLead")}</p>
        </div>
      </div>
      {heatmap ? (
        <>
          <Heatmap grid={heatmap} label={t("heatmap")} />
          {empty ? (
            <p className="small muted">{t("heatmapEmpty")}</p>
          ) : (
            <p className="heatmap-legend">
              {t("heatmapLegendLow")}
              <span className="heatmap-scale" aria-hidden="true" />
              {t("heatmapLegendHigh")}
            </p>
          )}
        </>
      ) : (
        <div className="locked" data-testid="heatmap-locked">
          <div className="locked-preview" aria-hidden="true">
            <Heatmap grid={SAMPLE_HEATMAP} label="" />
          </div>
          <div className="locked-overlay">
            <span className="lock-badge" aria-hidden="true">
              <LockSimpleIcon weight="bold" />
            </span>
            <p>{t("heatmapLocked")}</p>
            <Button asChild size="sm">
              <Link href="/shop">{upsell("cta")}</Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function HistoryRow({
  item,
  premium,
}: {
  item: MatchSummary;
  premium: boolean;
}) {
  const t = useTranslations("profile");
  const p = useTranslations("play");
  const levels = useTranslations("modes.levels");
  const locale = useLocale();
  const opponent =
    item.opponent.kind === "bot"
      ? p("botName", { level: levels(item.opponent.level) })
      : item.opponent.nickname;
  return (
    <li className="history-row">
      <span className="result-tag" data-result={item.result}>
        {t(item.result)}
      </span>
      <span className="history-main">
        <strong>
          {p("vs")} {opponent}
        </strong>
        <span className="history-meta">
          {t(`modes.${item.mode}`)} · {formatDateTime(item.finishedAt, locale)}
        </span>
      </span>
      <span className="history-side">
        {item.ratingDelta !== null ? (
          <span
            className="delta"
            data-sign={
              item.ratingDelta > 0
                ? "up"
                : item.ratingDelta < 0
                  ? "down"
                  : undefined
            }
          >
            {formatSigned(item.ratingDelta, locale)}
          </span>
        ) : null}
        {premium ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/replay/${item.matchId}`}>
              <PlayIcon />
              {t("replay")}
            </Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="ghost">
            <Link
              href="/shop"
              title={t("replayLocked")}
              aria-label={`${t("replay")}: ${t("replayLocked")}`}
            >
              <LockSimpleIcon />
              {t("replay")}
            </Link>
          </Button>
        )}
      </span>
    </li>
  );
}

const History = observer(function History({
  initial,
}: {
  initial: HistoryPage | null;
}) {
  const root = useRoot();
  const [stats] = useState(() => root.createStats({ history: initial }));
  const t = useTranslations("profile");
  const premium = root.session.premium;
  return (
    <section
      className="card"
      aria-labelledby="history-title"
      data-testid="history"
    >
      <h2 id="history-title">{t("history")}</h2>
      {initial === null ? (
        <p className="muted">{t("statsUnavailable")}</p>
      ) : stats.history.length === 0 ? (
        <p className="muted">{t("historyEmpty")}</p>
      ) : (
        <ul className="history">
          {stats.history.map((item) => (
            <HistoryRow key={item.matchId} item={item} premium={premium} />
          ))}
        </ul>
      )}
      {stats.nextCursor ? (
        <div className="history-more">
          <Button
            variant="outline"
            onClick={() => void stats.loadMore()}
            disabled={stats.historyState === "loading"}
            data-testid="load-more"
          >
            {stats.historyState === "error" ? <ArrowClockwiseIcon /> : null}
            {stats.historyState === "loading"
              ? t("loadingMore")
              : t("loadMore")}
          </Button>
          <span
            className="small"
            role="status"
            data-tone={stats.historyState === "error" ? "error" : undefined}
          >
            {stats.historyState === "error" ? t("historyError") : ""}
          </span>
        </div>
      ) : null}
    </section>
  );
});

/** Service record: stats, bot wins, heatmap (Premium), history and settings. */
export const ProfileView = observer(function ProfileView({
  stats,
  history,
}: {
  stats: PlayerStats | null;
  history: HistoryPage | null;
}) {
  const { session } = useRoot();
  const t = useTranslations("profile");
  const p = useTranslations("player");
  return (
    <>
      <header className="profile-head">
        <span className="avatar" data-size="lg" aria-hidden="true">
          {initialOf(session.nickname)}
        </span>
        <div className="stack-sm">
          <p className="og-eyebrow">{t("eyebrow")}</p>
          <h1 data-testid="profile-nickname">
            {session.nickname ?? t("title")}
          </h1>
          <p className="rating-meta">
            <span className="tabular">
              {p("rating", { rating: session.rating ?? 0 })}
            </span>
            {session.premium ? <PremiumBadge label={p("premium")} /> : null}
            {session.profile?.provisional ? (
              <span>{p("provisional")}</span>
            ) : null}
          </p>
        </div>
      </header>
      <div className="profile-grid">
        <div className="profile-col">
          <section className="card" aria-labelledby="stats-title">
            <h2 id="stats-title" className="sr-only">
              {t("title")}
            </h2>
            {stats ? (
              <StatsCard stats={stats} />
            ) : (
              <p className="muted">{t("statsUnavailable")}</p>
            )}
          </section>
          {stats ? <HeatmapCard heatmap={stats.heatmap} /> : null}
          <History initial={history} />
        </div>
        <div className="profile-col">
          <Settings />
          {stats ? <BotWins stats={stats} /> : null}
          <AccountCard />
        </div>
      </div>
    </>
  );
});
