"use client";

import type { RoundView, TableView } from "@outegro/contracts/roulette";
import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import type { Clock } from "@/game/stores/clock";
import { formatSeconds } from "@/lib/format";

/** The bar over the strip: time left to bet, the spin, the result and the pause. */
export const PhaseBar = observer(function PhaseBar({
  round,
  table,
  clock,
}: {
  round: RoundView | null;
  table: TableView | null;
  clock: Clock;
}) {
  const t = useTranslations("phase");
  const colors = useTranslations("colors");
  const locale = useLocale();
  const now = clock.serverNow;
  let fill = 0;
  let tone = "";
  let text = t("waiting");
  if (round && table) {
    const result = round.result;
    const spinEnd = round.rollingAt
      ? Date.parse(round.rollingAt) + table.timings.rollingMs
      : null;
    const shown =
      result &&
      (round.phase === "settled" || (spinEnd !== null && now >= spinEnd));
    if (round.phase === "voided") {
      tone = "is-void";
      text = t("voided");
    } else if (round.phase === "betting") {
      const left = Math.max(0, Date.parse(round.bettingEndsAt) - now);
      fill = Math.min(1, left / table.timings.bettingMs);
      text = round.table.paused
        ? t("paused")
        : t("betting", { seconds: formatSeconds(left, locale) });
    } else if (round.phase === "locked") {
      text = t("locked");
    } else if (shown && result) {
      tone = `is-${result.color}`;
      const color = colors(result.color);
      if (round.nextRoundAt) {
        const left = Math.max(0, Date.parse(round.nextRoundAt) - now);
        fill = Math.min(1, left / table.timings.settledMs);
        text = t("next", {
          number: result.number,
          color,
          seconds: formatSeconds(left, locale),
        });
      } else {
        fill = 1;
        text = t("result", { number: result.number, color });
      }
    } else {
      text = t("rolling");
    }
  }
  return (
    <div className={`rl-timer ${tone}`} data-phase={round?.phase ?? "none"}>
      <div className="rl-fill" style={{ transform: `scaleX(${fill})` }} />
      {/* Only phase changes are announced, not every tenth of a second. */}
      <div className="rl-timer-t" aria-hidden="true">
        {text}
      </div>
      <PhaseAnnouncement round={round} />
    </div>
  );
});

/** What a screen reader hears: the phase and the result, once each. */
function PhaseAnnouncement({ round }: { round: RoundView | null }) {
  const t = useTranslations("phase");
  const colors = useTranslations("colors");
  let text: string | null = null;
  if (round?.phase === "betting")
    text = round.table.paused ? t("paused") : t("open");
  if (round?.phase === "voided") text = t("voided");
  if (round?.phase === "locked") text = t("locked");
  if (round?.phase === "rolling") text = t("rolling");
  // The result is told once the strip has stopped, not before.
  if (round?.phase === "settled" && round.result)
    text = t("result", {
      number: round.result.number,
      color: colors(round.result.color),
    });
  return (
    <p className="sr-only" role="status">
      {text}
    </p>
  );
}
