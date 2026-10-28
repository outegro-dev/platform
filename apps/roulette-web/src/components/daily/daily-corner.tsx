"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import { GiftIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { countdown } from "@/game/daily-ribbon";
import { DailyStore } from "@/game/stores/daily-store";
import { formatAmount, formatPercent } from "@/lib/format";
import { GrumbleIcon } from "../grumble-icon";
import { useReducedMotion, useStore } from "../providers";
import { PrizeRibbon } from "./prize-ribbon";

/**
 * The bonus of the day in the bottom-right corner: a countdown to the next
 * one, alive when it can be taken; it opens the box with the prize ribbon.
 */
export const DailyCorner = observer(function DailyCorner() {
  const store = useStore();
  const t = useTranslations("daily");
  const reducedMotion = useReducedMotion();
  const [daily] = useState(
    () => new DailyStore({ onBalance: (balance) => store.setBalance(balance) }),
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void daily.load();
  }, [daily]);

  const now = store.clock.serverNow;
  const left = daily.msLeft(now);
  const ready = daily.isReady(now);

  // When the countdown runs out, the backend says whether it is time.
  const reloaded = useRef<string | null>(null);
  const nextAt = daily.status?.nextAt ?? null;
  const due = left === 0 && daily.status?.available === false;
  useEffect(() => {
    if (!due || reloaded.current === nextAt) return;
    reloaded.current = nextAt;
    void daily.load();
  }, [due, nextAt, daily]);

  const label =
    left !== null && left > 0
      ? t("buttonIn", { time: countdown(left) })
      : t("button");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="daily-btn"
          data-ready={ready || undefined}
          data-testid="daily-button"
        >
          <GiftIcon aria-hidden="true" />
          <span>{label}</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="daily-dialog"
        // A calm dialog is a paper page in the kit (zine.css), whatever the
        // page's tone: the light palette keeps its ink text readable on it.
        data-theme="zine-calm"
        closeLabel={t("close")}
      >
        <DialogTitle className="daily-title">{t("title")}</DialogTitle>
        <DialogDescription className="daily-lead">
          {t("lead")}
        </DialogDescription>
        <DailyBody
          daily={daily}
          now={now}
          ready={ready}
          reducedMotion={reducedMotion}
        />
      </DialogContent>
    </Dialog>
  );
});

const DailyBody = observer(function DailyBody({
  daily,
  now,
  ready,
  reducedMotion,
}: {
  daily: DailyStore;
  now: number;
  ready: boolean;
  reducedMotion: boolean;
}) {
  const t = useTranslations("daily");
  const locale = useLocale();
  const status = daily.status;
  const prizes = status?.prizes ?? [];
  const left = daily.msLeft(now);
  const total = prizes.reduce((sum, prize) => sum + prize.chance, 0) || 1;

  let message: string | null = null;
  if (daily.problem) {
    const problem = daily.problem;
    message =
      problem.error === "blocked"
        ? t(`reasons.${problem.reason}`)
        : problem.error === "not_yet"
          ? t("reasons.not_yet", { time: countdown(left ?? 0) })
          : t(`reasons.${problem.error}`);
  } else if (daily.claim && !daily.spinning) {
    message = t("won", { prize: daily.claim.prize });
  } else if (left !== null && left > 0) {
    message = t("nextIn", { time: countdown(left) });
  }

  return (
    <div className="daily-body">
      {status && (status.streak > 0 || status.streakBonusPercent > 0) ? (
        <p className="daily-streak">
          {t("streak", {
            streak: status.streak,
            percent: status.streakBonusPercent,
          })}
        </p>
      ) : null}
      {prizes.length > 0 ? (
        <PrizeRibbon
          prizes={prizes}
          claim={daily.claim}
          spinning={daily.spinning}
          reducedMotion={reducedMotion}
          onDone={daily.finishSpin}
        />
      ) : null}
      {prizes.length > 0 ? (
        <div className="daily-odds">
          <h3>{t("odds")}</h3>
          <ul>
            {prizes.map((prize, index) => (
              // Lines of the table never move.
              // biome-ignore lint/suspicious/noArrayIndexKey: the prize table's own order
              <li key={index}>
                <GrumbleIcon />
                <b>{formatAmount(prize.amount, locale)}</b>
                <span>
                  {t("chance", {
                    percent: formatPercent(
                      (prize.chance / total) * 100,
                      locale,
                    ),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="daily-foot">
        <Button
          type="button"
          onClick={() => void daily.take()}
          disabled={!ready || daily.loading}
          data-testid="daily-take"
        >
          {daily.spinning
            ? t("spinning")
            : daily.loading
              ? t("loading")
              : t("take")}
        </Button>
        <p className="daily-msg" role="status" aria-live="polite">
          {message}
        </p>
      </div>
    </div>
  );
});
