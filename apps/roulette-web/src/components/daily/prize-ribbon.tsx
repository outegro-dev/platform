"use client";

import type { DailyClaim, DailyPrize } from "@outegro/contracts/daily-bonus";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { prizeRibbon } from "@/game/daily-ribbon";
import { formatAmount } from "@/lib/format";
import { GrumbleIcon } from "../grumble-icon";

/** How long the ribbon runs, as in the mock's case. */
export const RIBBON_MS = 4200;

/** Prize tiers coloured from the smallest to the largest, like the mock's case. */
const tierColors = [
  "#7a6f58",
  "#a89b7c",
  "#2360b5",
  "#2d8a4a",
  "#cf3528",
  "#f5c518",
  "#f28fb1",
];

/**
 * The bonus box's ribbon: prize tiles under a marker. It waits a few tiles
 * short of the end; with a claim it runs to `prizes[prizeIndex]` (the
 * server's pick) and calls `onDone` when it stops.
 */
export function PrizeRibbon({
  prizes,
  claim,
  spinning,
  reducedMotion,
  onDone,
}: {
  prizes: DailyPrize[];
  claim: DailyClaim | null;
  spinning: boolean;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const locale = useLocale();
  const viewRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const ribbon = useMemo(
    () => prizeRibbon(prizes, claim?.prizeIndex ?? 0, claim?.claimNo ?? 1),
    [prizes, claim?.prizeIndex, claim?.claimNo],
  );
  const order = [...prizes]
    .map((prize, index) => ({ amount: prize.amount, index }))
    .sort((a, b) => a.amount - b.amount)
    .map((item) => item.index);

  useEffect(() => {
    const view = viewRef.current;
    const strip = stripRef.current;
    const first = strip?.firstElementChild;
    if (!view || !strip || !(first instanceof HTMLElement)) return;
    const tile = first.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
    const at = (index: number, within: number) =>
      view.clientWidth / 2 - (index * (tile + gap) + within * tile);
    if (!claim) {
      strip.style.transition = "none";
      strip.style.transform = `translate3d(${at(4, 0.5)}px, 0, 0)`;
      return;
    }
    const target = `translate3d(${at(ribbon.winAt, ribbon.within)}px, 0, 0)`;
    if (!spinning || reducedMotion) {
      strip.style.transition = "none";
      strip.style.transform = target;
      if (spinning) done.current();
      return;
    }
    strip.style.transition = "none";
    strip.style.transform = `translate3d(${at(4, 0.5)}px, 0, 0)`;
    void strip.offsetWidth;
    strip.style.transition = `transform ${RIBBON_MS}ms cubic-bezier(.1,.75,.18,1)`;
    strip.style.transform = target;
    // transitionend may never come (a hidden tab): a timer backs it up.
    const timer = setTimeout(() => done.current(), RIBBON_MS + 150);
    return () => clearTimeout(timer);
  }, [claim, spinning, reducedMotion, ribbon]);

  return (
    <div className="daily-view" ref={viewRef} aria-hidden="true">
      <div className="daily-strip" ref={stripRef}>
        {ribbon.tiles.map((prizeIndex, index) => {
          const tier = Math.max(0, order.indexOf(prizeIndex));
          return (
            <div
              // The ribbon is fixed for a claim: the position is the identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ribbon
              key={index}
              className="daily-prize"
              style={{
                borderTopColor:
                  tierColors[Math.min(tier, tierColors.length - 1)],
              }}
            >
              <GrumbleIcon className="size-5" />
              {formatAmount(prizes[prizeIndex]?.amount ?? 0, locale)}
            </div>
          );
        })}
      </div>
      <div className="rl-marker" />
    </div>
  );
}
