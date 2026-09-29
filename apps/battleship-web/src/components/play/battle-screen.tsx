"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import {
  FlagIcon,
  HourglassIcon,
  UserCircleDashedIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { cellName } from "../board/board-frame";
import { BoardLegend } from "../board/board-legend";
import { useRoot } from "../providers";
import { FleetPips, OwnBoard, TargetBoard } from "./boards";
import { MatchBar } from "./match-bar";

/**
 * Connection and match events above the boards. The slot keeps its height
 * whether a banner shows or not, so the boards never jump.
 */
export const BannerSlot = observer(function BannerSlot() {
  const { match, session } = useRoot();
  const t = useTranslations("battle");
  const c = useTranslations("connection");
  let banner: React.ReactNode = null;
  if (session.connection !== "ready" && session.connection !== "idle") {
    const offline = session.connection === "offline";
    banner = (
      <div
        className="banner"
        data-tone="warn"
        data-testid="banner-reconnecting"
      >
        {offline ? (
          <WifiSlashIcon aria-hidden="true" />
        ) : (
          <span className="spinner" aria-hidden="true" />
        )}
        <span>
          {offline
            ? c("offline")
            : session.connection === "unauthorized"
              ? c("unauthorized")
              : t("youReconnecting")}
        </span>
      </div>
    );
  } else if (!match.opponentConnected && match.active) {
    const seconds = match.graceSecondsLeft;
    banner = (
      <div
        className="banner"
        data-tone="info"
        data-testid="banner-opponent-away"
      >
        <UserCircleDashedIcon aria-hidden="true" />
        <span className="tabular">
          {seconds !== null
            ? t("opponentAway", { seconds })
            : t("opponentAwayNoTime")}
        </span>
      </div>
    );
  } else if (match.notice?.kind === "turn_skipped") {
    banner = (
      <div className="banner" data-tone="info" data-testid="banner-skipped">
        <HourglassIcon aria-hidden="true" />
        <span>
          {t(`skipped.${match.notice.side}`, {
            count: match.notice.missedInRow,
          })}
        </span>
      </div>
    );
  } else if (match.notice?.kind === "rejected") {
    const code = match.notice.code;
    const known = ["not_your_turn", "already_shot", "rate_limited"];
    banner = (
      <div className="banner" data-tone="error" data-testid="banner-rejected">
        <WarningCircleIcon aria-hidden="true" />
        <span>{t(`rejected.${known.includes(code) ? code : "generic"}`)}</span>
      </div>
    );
  }
  return (
    <div className="banner-slot" role="status" aria-live="polite">
      {banner}
    </div>
  );
});

const LastShot = observer(function LastShot() {
  const { match } = useRoot();
  const t = useTranslations("battle.last");
  const shot = match.lastShot;
  return (
    <p className="last-shot" data-testid="last-shot" aria-live="polite">
      {shot
        ? t(shot.by, {
            cell: cellName(shot.x, shot.y),
            outcome: t(`outcome.${shot.outcome}`),
          })
        : null}
    </p>
  );
});

const Resign = observer(function Resign() {
  const { match } = useRoot();
  const t = useTranslations("battle");
  const common = useTranslations("common");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={!match.active}>
          <FlagIcon />
          {t("resign")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={common("close")}>
        <DialogHeader>
          <DialogTitle>{t("resignTitle")}</DialogTitle>
          <DialogDescription>
            {match.rated ? t("resignBodyRated") : t("resignBody")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("resignCancel")}</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" onClick={match.resign}>
              {t("resignConfirm")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export const BattleScreen = observer(function BattleScreen() {
  const { match } = useRoot();
  const t = useTranslations("play");
  const ownAfloat = match.ownShips
    .filter((ship) => !ship.sunk)
    .map((ship) => ship.length);
  return (
    <section
      className="match"
      aria-labelledby="battle-title"
      data-testid="battle"
    >
      <h1 id="battle-title" className="sr-only">
        {t("enemyWaters")}
      </h1>
      <MatchBar />
      <BannerSlot />
      <div className="boards">
        <div className="board-column" data-board="own">
          <div className="board-caption">
            <h2>{t("yourWaters")}</h2>
            <FleetPips
              afloat={ownAfloat}
              label={t("shipsLeft", { count: ownAfloat.length })}
            />
          </div>
          <OwnBoard />
        </div>
        <div className="board-column" data-board="target">
          <div className="board-caption">
            <h2>{t("enemyWaters")}</h2>
            <FleetPips
              afloat={match.remaining}
              label={t("shipsLeft", { count: match.remaining.length })}
            />
          </div>
          <TargetBoard />
        </div>
      </div>
      <div className="match-foot">
        <LastShot />
        <Resign />
      </div>
      <BoardLegend mode="battle" />
    </section>
  );
});
