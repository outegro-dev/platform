"use client";

import { roomCodeSchema } from "@outegro/contracts/battleship";
import { Button } from "@outegro/ui/button";
import {
  CheckIcon,
  CopyIcon,
  LinkBreakIcon,
  XIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";
import { useRoot } from "../providers";

function Notice({
  title,
  body,
  children,
  testId,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="notice" data-testid={testId}>
      <span className="notice-icon" aria-hidden="true">
        <LinkBreakIcon />
      </span>
      <h1>{title}</h1>
      {body ? <p>{body}</p> : null}
      <div className="notice-actions">{children}</div>
    </section>
  );
}

/**
 * A private room: the creator sees the code, the invite link and a waiting
 * radar; a friend opening the link joins automatically once connected.
 */
export const RoomScreen = observer(function RoomScreen({
  code,
  shareUrl,
}: {
  code: string;
  shareUrl: string;
}) {
  const { lobby, session } = useRoot();
  const t = useTranslations("room");
  const p = useTranslations("play");
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const joined = useRef(false);
  const valid = roomCodeSchema.safeParse(code).success;
  const known = session.activeMatchId !== undefined && session.online;
  const mine = lobby.room?.code === code;

  useEffect(() => {
    if (!valid || !known || mine || joined.current) return;
    if (lobby.roomClosed) return;
    joined.current = true;
    lobby.joinRoom(code);
  }, [valid, known, mine, code, lobby]);

  useEffect(() => {
    if (copied === "idle") return;
    const timer = window.setTimeout(() => setCopied("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!valid) {
    return (
      <Notice title={t("invalid")} testId="room-invalid">
        <Button asChild size="lg">
          <Link href="/">{p("toLobby")}</Link>
        </Button>
      </Notice>
    );
  }

  if (mine && lobby.room) {
    const seconds = lobby.roomSecondsLeft ?? 0;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied("ok");
      } catch {
        setCopied("failed");
      }
    };
    return (
      <section
        className="room"
        aria-labelledby="room-title"
        data-testid="room-host"
      >
        <div className="stack-lg">
          <p className="og-eyebrow">{t("title")}</p>
          <h1 id="room-title" className="section-title">
            {t("waiting")}
          </h1>
          <div
            className="room-code"
            role="img"
            aria-label={`${t("code")}: ${code.split("").join(" ")}`}
          >
            {code.split("").map((char, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed code
              <span key={i}>{char}</span>
            ))}
          </div>
          <div className="field">
            <span className="small muted">{t("shareLabel")}</span>
            <div className="share-row">
              <span className="share-url" data-testid="share-url">
                {shareUrl}
              </span>
              <Button variant="secondary" onClick={copy}>
                {copied === "ok" ? <CheckIcon /> : <CopyIcon />}
                {t("copy")}
              </Button>
            </div>
            <p
              className="field-hint"
              role="status"
              data-tone={
                copied === "ok"
                  ? "ok"
                  : copied === "failed"
                    ? "error"
                    : undefined
              }
            >
              {copied === "ok"
                ? t("copied")
                : copied === "failed"
                  ? t("copyFailed")
                  : t("expires", { time: formatClock(seconds) })}
            </p>
          </div>
          <div className="notice-actions">
            <Button
              variant="outline"
              onClick={lobby.cancelRoom}
              disabled={lobby.isBusy("room.cancel")}
            >
              <XIcon />
              {t("cancel")}
            </Button>
          </div>
        </div>
        <div className="radar" aria-hidden="true" />
      </section>
    );
  }

  if (lobby.roomClosed && !lobby.room) {
    return (
      <Notice
        title={
          lobby.roomClosed === "expired"
            ? t("closedExpired")
            : t("closedCancelled")
        }
        testId="room-closed"
      >
        <Button size="lg" onClick={lobby.createRoom} disabled={!session.online}>
          {t("newRoom")}
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">{p("toLobby")}</Link>
        </Button>
      </Notice>
    );
  }

  if (lobby.error === "room_not_found" || lobby.error === "own_room") {
    return (
      <Notice
        title={lobby.error === "own_room" ? t("own") : t("notFound")}
        testId="room-error"
      >
        <Button asChild size="lg">
          <Link href="/" onClick={() => lobby.clearError()}>
            {p("toLobby")}
          </Link>
        </Button>
      </Notice>
    );
  }

  return (
    <section className="room" data-testid="room-joining">
      <div className="stack-lg">
        <p className="og-eyebrow">{t("title")}</p>
        <h1 className="section-title" role="status">
          {t("joining", { code })}
        </h1>
        <div className="room-code" aria-hidden="true">
          {code.split("").map((char, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed code
            <span key={i}>{char}</span>
          ))}
        </div>
      </div>
      <div className="radar" aria-hidden="true" />
    </section>
  );
});
