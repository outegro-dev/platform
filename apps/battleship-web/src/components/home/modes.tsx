"use client";

import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import {
  LightningIcon,
  LinkIcon,
  LockSimpleIcon,
  RobotIcon,
  WarningCircleIcon,
  WavesIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import {
  type BotLevel,
  botLevels,
  type LobbyError,
} from "@/game/stores/lobby-store";
import { formatClock } from "@/lib/format";
import { useRoot } from "../providers";
import { UpsellDialog } from "./upsell-dialog";

function useLobbyError() {
  const t = useTranslations("lobbyErrors");
  return (error: LobbyError | null) => {
    if (!error) return null;
    const known: LobbyError[] = [
      "premium_required",
      "invalid_room_code",
      "room_not_found",
      "own_room",
      "already_in_match",
      "already_queued",
      "rate_limited",
      "offline",
    ];
    return known.includes(error)
      ? t(error as "premium_required")
      : t("generic");
  };
}

/** Button text that changes without changing the button's width. */
export function StableLabel({
  active,
  on,
  off,
}: {
  active: boolean;
  on: string;
  off: string;
}) {
  return (
    <span className="stable-label">
      <span data-off={active ? undefined : true} aria-hidden={!active}>
        {on}
      </span>
      <span data-off={active ? true : undefined} aria-hidden={active}>
        {off}
      </span>
    </span>
  );
}

const BotCard = observer(function BotCard() {
  const { lobby, session } = useRoot();
  const t = useTranslations("modes");
  const errorText = useLobbyError();
  const [upsell, setUpsell] = useState(false);
  const lockedId = useId();
  const busy = lobby.isBusy("bot");
  const online = session.online;
  const serverRefused = lobby.error === "premium_required" && session.premium;
  const start = () => {
    if (!lobby.startBot()) setUpsell(true);
  };
  const error =
    lobby.pending === null && lobby.error && lobby.error !== "invalid_room_code"
      ? lobby.error
      : null;
  const botError =
    error === "premium_required" ||
    error === "already_in_match" ||
    error === "rate_limited"
      ? error
      : null;
  return (
    <article className="card mode-card" data-testid="mode-bot">
      <div className="card-head">
        <span className="card-icon" aria-hidden="true">
          <RobotIcon />
        </span>
      </div>
      <div className="mode-body">
        <h2>{t("bot.title")}</h2>
        <p>{t("bot.lead")}</p>
        <fieldset className="levels">
          <legend className="sr-only">{t("bot.levelsLabel")}</legend>
          {botLevels.map((level: BotLevel) => {
            const locked = lobby.isLocked(level);
            return (
              <label key={level} className="segment level choice-tile">
                <input
                  type="radio"
                  name="bot-level"
                  value={level}
                  checked={lobby.selectedLevel === level}
                  onChange={() => lobby.selectLevel(level)}
                  aria-describedby={locked ? lockedId : undefined}
                />
                {locked ? (
                  <LockSimpleIcon
                    className="segment-lock"
                    weight="bold"
                    aria-hidden="true"
                  />
                ) : null}
                <span>{t(`levels.${level}`)}</span>
                <span className="segment-hint">{t(`levels.${level}Hint`)}</span>
              </label>
            );
          })}
          <span id={lockedId} className="sr-only">
            {t("locked")}
          </span>
        </fieldset>
      </div>
      <p
        className="status-line"
        role="status"
        data-tone={botError ? "error" : undefined}
      >
        {!online ? (
          t("offline")
        ) : botError ? (
          <>
            <WarningCircleIcon aria-hidden="true" />
            {errorText(botError)}
          </>
        ) : lobby.isLocked(lobby.selectedLevel) ? (
          <>
            <LockSimpleIcon aria-hidden="true" />
            {errorText("premium_required")}
          </>
        ) : null}
      </p>
      <div className="card-actions">
        <Button
          size="lg"
          onClick={start}
          disabled={!online || busy}
          data-testid="start-bot"
        >
          <StableLabel
            active={busy}
            on={t("bot.starting")}
            off={t("bot.start")}
          />
        </Button>
      </div>
      <UpsellDialog
        open={upsell || serverRefused}
        onOpenChange={(open) => {
          setUpsell(open);
          if (!open) lobby.clearError();
        }}
        fromServer={serverRefused}
      />
    </article>
  );
});

const QuickCard = observer(function QuickCard() {
  const { lobby, session } = useRoot();
  const t = useTranslations("modes");
  const errorText = useLobbyError();
  const queued = lobby.queued;
  const joining = lobby.isBusy("queue.join");
  const leaving = lobby.isBusy("queue.leave");
  const error =
    lobby.error === "already_queued" || lobby.error === "already_in_match"
      ? lobby.error
      : null;
  return (
    <article className="card mode-card" data-testid="mode-quick">
      <div className="card-head">
        <span className="card-icon" aria-hidden="true">
          <LightningIcon />
        </span>
      </div>
      <div className="mode-body">
        <h2>{t("quick.title")}</h2>
        <p>{t("quick.lead")}</p>
        <div
          className="queue-status"
          data-active={queued || undefined}
          role="status"
          aria-live="polite"
        >
          <span
            className="sonar"
            data-active={queued || undefined}
            aria-hidden="true"
          >
            <WavesIcon />
          </span>
          {queued
            ? t("quick.searching", { time: formatClock(lobby.queueSeconds) })
            : t("quick.idle")}
        </div>
      </div>
      <p className="status-line" data-tone={error ? "error" : undefined}>
        {!session.online ? t("offline") : error ? errorText(error) : null}
      </p>
      <div className="card-actions">
        {queued ? (
          <Button
            size="lg"
            variant="outline"
            onClick={lobby.leaveQueue}
            disabled={leaving}
            data-testid="leave-queue"
          >
            <StableLabel
              active={leaving}
              on={t("quick.cancelling")}
              off={t("quick.cancel")}
            />
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={lobby.joinQueue}
            disabled={!session.online || joining}
            data-testid="join-queue"
          >
            <StableLabel
              active={joining}
              on={t("quick.joining")}
              off={t("quick.find")}
            />
          </Button>
        )}
      </div>
    </article>
  );
});

const RoomCard = observer(function RoomCard() {
  const { lobby, session } = useRoot();
  const t = useTranslations("modes");
  const errorText = useLobbyError();
  const [code, setCode] = useState("");
  const inputId = useId();
  const hintId = useId();
  const creating = lobby.isBusy("room.create");
  const joining = lobby.isBusy("room.join");
  const error =
    lobby.error === "invalid_room_code" ||
    lobby.error === "room_not_found" ||
    lobby.error === "own_room"
      ? lobby.error
      : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    lobby.joinRoom(code);
  };
  return (
    <article className="card mode-card" data-testid="mode-room">
      <div className="card-head">
        <span className="card-icon" aria-hidden="true">
          <LinkIcon />
        </span>
      </div>
      <div className="mode-body">
        <h2>{t("room.title")}</h2>
        <p>{t("room.lead")}</p>
        <form className="field" onSubmit={submit} noValidate>
          <label htmlFor={inputId} className="field-label">
            {t("room.or")}
          </label>
          <div className="field-row">
            <Input
              id={inputId}
              className="code-input"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (error) lobby.clearError();
              }}
              placeholder={t("room.codePlaceholder")}
              maxLength={9}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={hintId}
              data-testid="room-code-input"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!session.online || joining || code.trim() === ""}
              data-testid="join-room"
            >
              <StableLabel
                active={joining}
                on={t("room.joining")}
                off={t("room.join")}
              />
            </Button>
          </div>
          <p
            id={hintId}
            className="field-hint"
            data-tone={error ? "error" : undefined}
            role="status"
          >
            {error ? errorText(error) : !session.online ? t("offline") : ""}
          </p>
        </form>
      </div>
      <span />
      <div className="card-actions">
        <Button
          size="lg"
          variant="secondary"
          onClick={lobby.createRoom}
          disabled={!session.online || creating}
          data-testid="create-room"
        >
          <StableLabel
            active={creating}
            on={t("room.creating")}
            off={t("room.create")}
          />
        </Button>
      </div>
    </article>
  );
});

/** The three ways to play, bound to the lobby store. */
export function Modes() {
  return (
    <div className="modes">
      <BotCard />
      <QuickCard />
      <RoomCard />
    </div>
  );
}
