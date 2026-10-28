"use client";

import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { type FxMoment, fxAt, rainDrops } from "@/game/effects";
import type { RouletteStore } from "@/game/stores/roulette-store";
import { GrumbleIcon } from "../grumble-icon";
import { useSound } from "../providers";
import { StripView } from "./strip-view";

/** The moment of the current round: spinning, just stopped, or neither. */
function useFxMoment(store: RouletteStore, reducedMotion: boolean): FxMoment {
  const round = store.round;
  const spin = store.spin;
  return fxAt({
    round: round?.round ?? 0,
    result: round?.result ?? null,
    startAt: spin?.startAt ?? null,
    durationMs: spin?.durationMs ?? 0,
    // Ticks while observed: the stage re-renders, the strip itself does not.
    now: store.clock.serverNow,
    reducedMotion,
  });
}

/**
 * The strip with what happens on it: speed lines during a mega spin, the
 * stamps and the shake on the stop, and the stop's sound. The look follows
 * from the round number and the result only, so every screen shows the same.
 */
export const StripStage = observer(function StripStage({
  store,
  reducedMotion,
}: {
  store: RouletteStore;
  reducedMotion: boolean;
}) {
  const t = useTranslations("fx");
  const sound = useSound();
  const moment = useFxMoment(store, reducedMotion);
  const { effects } = moment;
  const round = store.round?.round ?? null;

  // One sound per stop, when the strip reaches it.
  const played = useRef<number | null>(null);
  useEffect(() => {
    if (!moment.stopped || round === null || played.current === round) return;
    played.current = round;
    sound.play(effects.green ? "green" : effects.mega ? "mega" : "stop");
  }, [moment.stopped, round, effects.green, effects.mega, sound]);

  return (
    <div
      className="rl-stage"
      data-mega={effects.mega || undefined}
      data-speed={(moment.spinning && effects.speedLines) || undefined}
      data-shake={(moment.stopped && effects.shake) || undefined}
    >
      <StripView
        rest={store.rest}
        spin={store.spin}
        serverNow={() => Date.now() + store.clock.offsetMs}
        reducedMotion={reducedMotion}
      />
      {moment.spinning && effects.speedLines ? (
        <div className="rl-speed" aria-hidden="true" />
      ) : null}
      {moment.stopped && effects.stamps.length > 0 ? (
        <div className="rl-stamps" key={`stamps-${round}`}>
          {effects.stamps.map((stamp) => (
            <span key={stamp} className={`rl-stamp rl-stamp-${stamp}`}>
              {t(stamp)}
            </span>
          ))}
          <span className="sr-only">
            {effects.green ? t("greenWin") : t("megaRound")}
          </span>
        </div>
      ) : null}
    </div>
  );
});

/** Over the whole table on green: the flash and the rain of grumbles. */
export const TableFx = observer(function TableFx({
  store,
  reducedMotion,
}: {
  store: RouletteStore;
  reducedMotion: boolean;
}) {
  const moment = useFxMoment(store, reducedMotion);
  const round = store.round?.round ?? 0;
  if (!moment.stopped) return null;
  return (
    <>
      {moment.effects.flash ? (
        <div className="rl-flash" key={`flash-${round}`} aria-hidden="true" />
      ) : null}
      {moment.effects.rain ? (
        <div className="rl-rain" key={`rain-${round}`} aria-hidden="true">
          {rainDrops().map((drop, index) => (
            <GrumbleIcon
              // Fixed drops, the same on every screen.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of drops
              key={index}
              className="rl-drop"
              style={{
                left: `${drop.left}%`,
                width: drop.size,
                height: drop.size,
                animationDelay: `${drop.delayMs}ms`,
                animationDuration: `${drop.durationMs}ms`,
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
});
