"use client";

import { CrownSimpleIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRoot } from "../providers";

export function initialOf(nickname: string | null): string {
  const letter = nickname?.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return (letter ?? "?").toUpperCase();
}

export function PremiumBadge({ label }: { label: string }) {
  return (
    <span className="premium-badge">
      <CrownSimpleIcon weight="fill" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Nickname, rating and connection at a glance; opens the profile. */
export const PlayerChip = observer(function PlayerChip() {
  const { session } = useRoot();
  const t = useTranslations("player");
  const c = useTranslations("connection");
  const nickname = session.nickname ?? "…";
  const rating = session.rating ?? 0;
  const status = session.connection;
  const connection =
    status === "ready"
      ? session.rtt !== null
        ? c("readyRtt", { rtt: Math.round(session.rtt) })
        : c("ready")
      : status === "connecting" && session.attempts >= 2
        ? c("unavailable")
        : c(status);
  return (
    <Link
      href="/profile"
      className="player-chip og-glass"
      aria-label={`${t("chipLabel", { nickname, rating })}. ${connection}`}
      title={connection}
      data-testid="player-chip"
    >
      <span className="avatar" aria-hidden="true">
        {initialOf(session.nickname)}
        <span className="conn-dot" data-status={status} />
      </span>
      <span className="player-chip-text" aria-hidden="true">
        <span className="player-chip-name">{nickname}</span>
        <span className="player-chip-meta">
          {rating}
          {session.premium ? <PremiumBadge label={t("premium")} /> : null}
        </span>
      </span>
    </Link>
  );
});
