"use client";

import { type Color, multipliers } from "@outegro/roulette-engine";
import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import { columnView } from "@/game/columns";
import type { RouletteStore } from "@/game/stores/roulette-store";
import { formatAmount } from "@/lib/format";
import { GrumbleIcon } from "../grumble-icon";

/** The mock's order: red, green, black. */
const order: Color[] = ["red", "green", "black"];
const ranges: Record<Color, string> = { red: "1–7", green: "0", black: "8–14" };

/** Three colours: the bet button, the totals and the biggest bets, yours always shown. */
export const Columns = observer(function Columns({
  store,
}: {
  store: RouletteStore;
}) {
  return (
    <div className="rl-cols">
      {order.map((color) => (
        <Column key={color} store={store} color={color} />
      ))}
    </div>
  );
});

const Column = observer(function Column({
  store,
  color,
}: {
  store: RouletteStore;
  color: Color;
}) {
  const t = useTranslations("column");
  const colors = useTranslations("colors");
  const locale = useLocale();
  const round = store.round;
  const totals = round?.totals[color] ?? { count: 0, sum: 0, top: [] };
  const view = columnView(
    totals,
    store.betsOn(color),
    store.player?.nickname ?? "",
  );
  // Payouts show once the strip has stopped (settled), not during the spin.
  const winner =
    round?.phase === "settled" && round.result ? round.result.color : null;
  const won = winner === color;
  const multiplier = multipliers[color];
  return (
    <section
      className={`rl-col${winner && !won ? " dim" : ""}${won ? " won" : ""}${won && color === "green" ? " green-win" : ""}`}
      aria-label={colors(color)}
    >
      <button
        className={`rl-colbtn ${color}`}
        type="button"
        onClick={() => store.placeBet(color)}
        disabled={round?.table.paused ?? false}
        aria-label={t("bet", { color: colors(color), multiplier })}
        data-testid={`bet-${color}`}
      >
        <span>
          {colors(color)} {ranges[color]}
        </span>
        <small>×{multiplier}</small>
      </button>
      <div className="rl-sum">
        <span>{t("players", { count: view.count })}</span>
        <b>
          <GrumbleIcon />
          {formatAmount(view.sum, locale)}
        </b>
      </div>
      <ul className="rl-list">
        {view.lines.length === 0 ? (
          <li className="rl-empty">{t("empty")}</li>
        ) : (
          view.lines.map((line) => (
            <li key={line.key} className={line.mine ? "me" : undefined}>
              <span className="rl-av" aria-hidden="true">
                {line.nickname.slice(0, 1).toUpperCase()}
              </span>
              <span className="rl-nm">
                {line.nickname}
                {line.mine ? (
                  <span className="sr-only">, {t("you")}</span>
                ) : null}
              </span>
              <span className={`rl-am${won ? " win" : ""}`}>
                <GrumbleIcon />
                {won ? (
                  <>
                    <span className="sr-only">{t("won")} </span>+
                    {formatAmount(line.amount * multiplier, locale)}
                  </>
                ) : (
                  formatAmount(line.amount, locale)
                )}
              </span>
            </li>
          ))
        )}
        {view.more > 0 ? (
          <li className="rl-more">{t("more", { count: view.more })}</li>
        ) : null}
      </ul>
    </section>
  );
});
