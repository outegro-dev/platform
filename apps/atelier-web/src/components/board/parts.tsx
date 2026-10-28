"use client";

import type { ApplicationFlag, ChannelKind } from "@outegro/contracts/atelier";
import {
  BrowserIcon,
  CalendarDotsIcon,
  ClockCounterClockwiseIcon,
  CursorClickIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  HandIcon,
  LinkedinLogoIcon,
  MegaphoneSimpleIcon,
  PencilSimpleIcon,
  TelegramLogoIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type Age, ageOf, scoreTone } from "@/lib/format";

export const flagIcons: Record<ApplicationFlag, typeof EyeIcon> = {
  needs_edit: PencilSimpleIcon,
  needs_human: HandIcon,
  follow_up: ClockCounterClockwiseIcon,
  meeting: CalendarDotsIcon,
  cv_opened: EyeIcon,
  dodep: MegaphoneSimpleIcon,
};

/** Flags as signals: red for a broken build, the highlighter for "needs you". */
const flagTones: Record<ApplicationFlag, string> = {
  needs_edit: "danger",
  needs_human: "warn",
  follow_up: "info",
  meeting: "ok",
  cv_opened: "ok",
  dodep: "neutral",
};

export const channelIcons: Record<ChannelKind, typeof EyeIcon> = {
  ats_form: BrowserIcon,
  email: EnvelopeSimpleIcon,
  telegram: TelegramLogoIcon,
  linkedin: LinkedinLogoIcon,
  manual: CursorClickIcon,
};

/** The fit score in a small box, tinted by how strong it is. */
export function ScoreChip({
  score,
  size = "sm",
}: {
  score: number | null;
  size?: "sm" | "lg";
}) {
  const t = useTranslations("score");
  const label = score === null ? t("none") : t("label", { score });
  return (
    <span
      className="score-chip"
      data-tone={scoreTone(score)}
      data-none={score === null || undefined}
      data-size={size}
      title={label}
    >
      <span aria-hidden="true">{score === null ? "··" : score}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A flag as a small labelled chip: an icon and the word, never colour alone. */
export function FlagChip({ flag }: { flag: ApplicationFlag }) {
  const t = useTranslations("flags");
  const Icon = flagIcons[flag];
  return (
    <span className="flag-chip" data-tone={flagTones[flag]}>
      <Icon aria-hidden="true" weight="bold" />
      {t(flag)}
    </span>
  );
}

export function FlagList({
  flags,
  label,
}: {
  flags: ApplicationFlag[];
  label: string;
}) {
  if (!flags.length) return null;
  return (
    <ul className="flag-list" aria-label={label}>
      {flags.map((flag) => (
        <li key={flag}>
          <FlagChip flag={flag} />
        </li>
      ))}
    </ul>
  );
}

export function ChannelLabel({ channel }: { channel: ChannelKind | null }) {
  const t = useTranslations("channels");
  if (!channel) return null;
  const Icon = channelIcons[channel];
  return (
    <span className="channel">
      <Icon aria-hidden="true" />
      {t(channel)}
    </span>
  );
}

/** A source's display name ("headhunter.ge" → "hh.ge"); unknown ones as they are. */
export function useSourceLabel() {
  const t = useTranslations("sources");
  return (source: string) => {
    const key = source.replace(/\./g, "_");
    return t.has(key) ? t(key) : source;
  };
}

/** "3d" on the card, "Updated 3 days ago" for a screen reader. */
export function AgeLabel({ iso, now }: { iso: string; now: number }) {
  const t = useTranslations("age");
  const age: Age = ageOf(iso, now);
  const short = age.unit === "now" ? t("now") : t(age.unit, { n: age.n });
  return (
    <time className="age" dateTime={iso}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">
        {age.unit === "now" ? t("labelNow") : t("label", { when: short })}
      </span>
    </time>
  );
}
