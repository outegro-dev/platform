"use client";

import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { cn } from "@outegro/ui/lib/utils";
import { Surface } from "@outegro/ui/surface";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { signInHref } from "@/lib/routes";
import type { Verdict } from "@/stores/attempt-store";
import { useReaderStores } from "@/stores/provider";
import type { SyncStatus } from "@/stores/sync-status-store";

export type LineTone = "neutral" | "pending" | "success" | "error";

/** The tone of a result line for a verdict (none yet: neutral). */
export function verdictTone(verdict: Verdict | null): LineTone {
  if (!verdict) return "neutral";
  if (verdict.state === "checking") return "pending";
  return verdict.correct ? "success" : "error";
}

/**
 * The top line of an exercise: what kind it is and, once the server has
 * recorded it as solved, a mark. The mark's place is kept, so it appears
 * without moving anything.
 */
export const ExerciseLabel = observer(function ExerciseLabel({
  label,
  id,
}: {
  label: string;
  id?: string;
}) {
  "use no memo";
  const { progress } = useReaderStores();
  const t = useTranslations("book.exercise");
  const solved = id ? progress.isSolved(id) : false;
  return (
    <p className="ex-label">
      <span>{label}</span>
      {id ? (
        <span className="ex-solved" data-on={solved || undefined}>
          {solved ? (
            <>
              <CheckCircleIcon aria-hidden="true" weight="fill" />
              {t("solved")}
            </>
          ) : null}
        </span>
      ) : null}
    </p>
  );
});

/**
 * The frame of an exercise: a card (kit Surface) in the reading column,
 * with the exercise's id as its anchor (a link can point at it).
 */
export function ExerciseFrame({
  label,
  id,
  children,
  className,
}: {
  label: string;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Surface className={cn("exercise", className)} id={id} data-exercise={id}>
      <ExerciseLabel label={label} id={id} />
      {children}
    </Surface>
  );
}

/**
 * The exercise's result: checking, the verdict or the progress so far. Two
 * lines are always kept for it, so it appears and changes without moving
 * anything; changes are announced.
 */
export function ResultLine({
  tone,
  children,
}: {
  tone: LineTone;
  children: ReactNode;
}) {
  return (
    <FormMessage
      className="ex-result"
      tone={tone}
      lines={2}
      role="status"
      data-testid="ex-result"
    >
      {children}
    </FormMessage>
  );
}

/** The book's explanation, opened once the reader has answered. */
export function Explanation({ children }: { children: ReactNode }) {
  const t = useTranslations("book.exercise");
  return (
    <div className="why">
      <p className="why-title">{t("explanation")}</p>
      {children}
    </div>
  );
}

const messageKeys = {
  saved: "saved",
  failed: "failed",
  offline: "offline",
  "signed-out": "signedOut",
  forbidden: "forbidden",
  "not-found": "notFound",
  invalid: "invalid",
  "too-large": "tooLarge",
} as const;

/**
 * A save message's box. Next to its Retry button on a narrow phone it has
 * about 110 px, and the longer messages ("Не сохранено: нет ответа
 * сервера.", "Нет сети: 25 отметок не сохранено.") take three lines:
 * there three are kept from the start (two elsewhere), so the message and
 * its button appear without moving anything.
 */
export const SAVE_MESSAGE = "save-message max-[420px]:min-h-15";

function toneOf(status: SyncStatus | null): LineTone {
  if (status === null || status === "saving") return "neutral";
  return status === "saved" ? "success" : "error";
}

/**
 * Whether an attempt reached the reader's account: saved, or why not — a
 * retry that resends the same attempt, a way to sign in again, or, when
 * the server refused it for good, the reason alone. Signed out there is
 * nothing here: the page says once that progress is saved after sign-in.
 * The line keeps its height (the Retry button's, and two lines of text —
 * three on a narrow phone), whatever it says.
 */
export const SaveLine = observer(function SaveLine({
  saveKey,
}: {
  saveKey: string;
}) {
  "use no memo";
  const { sync, signedIn } = useReaderStores();
  const t = useTranslations("book.save");
  const pathname = usePathname();
  const message = useRef<HTMLParagraphElement>(null);
  const [retrying, setRetrying] = useState(false);
  const status = sync.statusOf(saveKey);
  const canRetry = sync.canRetry(saveKey);

  // A retry that ended takes its button away unless another retry may
  // help (saved, signed out, refused for good): focus goes to the line
  // that says how it ended, never to the start of the page.
  useEffect(() => {
    if (!retrying || status === "saving") return;
    setRetrying(false);
    if (!canRetry) message.current?.focus();
  }, [retrying, status, canRetry]);

  if (!signedIn) return null;
  const key = status && status !== "saving" ? messageKeys[status] : null;
  const showRetry = canRetry || (retrying && status === "saving");
  return (
    <div className="save-line" data-status={status ?? undefined}>
      <FormMessage
        ref={message}
        tabIndex={-1}
        className={SAVE_MESSAGE}
        tone={toneOf(status)}
        lines={2}
        icon={
          status === "offline" ? (
            <WifiSlashIcon aria-hidden="true" weight="bold" />
          ) : undefined
        }
        aria-live="polite"
        data-testid="save-status"
      >
        {key ? t(key) : null}
      </FormMessage>
      {showRetry ? (
        <Button
          size="sm"
          variant="outline"
          className="save-action"
          pending={status === "saving"}
          pendingLabel={t("saving")}
          onClick={() => {
            setRetrying(true);
            void sync.retry(saveKey);
          }}
        >
          <ArrowClockwiseIcon aria-hidden="true" />
          {t("retry")}
        </Button>
      ) : null}
      {status === "signed-out" ? (
        <Button asChild size="sm" variant="link" className="save-action">
          <a href={signInHref(pathname || "/")}>{t("signIn")}</a>
        </Button>
      ) : null}
    </div>
  );
});
