"use client";

import { Button } from "@outegro/ui/button";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatClock } from "@/lib/format";
import { signInHref } from "@/lib/routes";
import { useRoot } from "../providers";

/**
 * One floating pill for what happens outside the current page: the quick
 * match search, a match in progress, an open room, or a connection problem.
 * It is fixed-positioned, so it never pushes the page around.
 */
export const StatusPill = observer(function StatusPill() {
  const root = useRoot();
  const { session, lobby, match } = root;
  const pathname = usePathname();
  const t = useTranslations("strip");
  const c = useTranslations("connection");
  const onPlay = pathname === "/play";
  const onHome = pathname === "/";

  let content: React.ReactNode = null;
  let tone: "ok" | "warn" | "bad" = "ok";

  if (!session.signedIn) {
    content = null;
  } else if (session.connection === "unauthorized") {
    tone = "bad";
    content = (
      <>
        <span className="status-pill-text">
          <span className="pulse-dot" data-tone="bad" aria-hidden="true" />
          {c("unauthorized")}
        </span>
        <Button asChild size="sm">
          <a href={signInHref(pathname)}>{c("signInAgain")}</a>
        </Button>
      </>
    );
  } else if (
    !onPlay &&
    (session.connection === "reconnecting" ||
      session.connection === "offline" ||
      (session.connection === "connecting" && session.attempts >= 2))
  ) {
    tone = session.connection === "offline" ? "bad" : "warn";
    content = (
      <>
        <span className="status-pill-text">
          <span className="pulse-dot" data-tone={tone} aria-hidden="true" />
          {session.connection === "offline"
            ? c("offline")
            : session.connection === "reconnecting"
              ? c("reconnecting")
              : c("unavailable")}
        </span>
        {session.connection !== "offline" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => root.socket.retryNow()}
          >
            {c("retry")}
          </Button>
        ) : null}
      </>
    );
  } else if (match.active && !onPlay) {
    content = (
      <>
        <span className="status-pill-text">
          <span className="pulse-dot" aria-hidden="true" />
          {t("inMatch")}
        </span>
        <Button asChild size="sm">
          <Link href="/play">{t("return")}</Link>
        </Button>
      </>
    );
  } else if (lobby.queued && !onHome) {
    content = (
      <>
        <span className="status-pill-text">
          <span className="pulse-dot" aria-hidden="true" />
          {t("searching", { time: formatClock(lobby.queueSeconds) })}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={lobby.leaveQueue}
          disabled={lobby.isBusy("queue.leave")}
        >
          {t("cancel")}
        </Button>
      </>
    );
  } else if (lobby.room && !pathname.startsWith("/room/")) {
    content = (
      <>
        <span className="status-pill-text">
          <span className="pulse-dot" aria-hidden="true" />
          {t("roomOpen", { code: lobby.room.code })}
        </span>
        <Button asChild size="sm">
          <Link href={`/room/${lobby.room.code}`}>{t("openRoom")}</Link>
        </Button>
      </>
    );
  }

  return (
    <div
      className="status-pill og-glass"
      data-hidden={content ? undefined : true}
      data-tone={tone}
      role="status"
      aria-live="polite"
    >
      {content}
    </div>
  );
});
