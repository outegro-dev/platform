"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon, StopCircleIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { ScrollRegion } from "@/components/islands/scroll-region";
import type { AssistKind } from "@/lib/assist/protocol";
import { signInHref } from "@/lib/routes";
import type { AnswerFailure, AnswerStore } from "@/stores/answer-store";
import type { AssistStore } from "@/stores/assist-store";
import { useReaderStores } from "@/stores/provider";
import { type AnswerCodeLabels, AssistMarkdown } from "./markdown";

/*
 * What the assistant's three helpers share: the answer's place (reserved
 * once a request starts, a box of fixed height that scrolls inside, so the
 * text streaming in never moves the page), its notes and actions, today's
 * quota, and where focus goes when the assistant turns off under it.
 * Texts are the book's (`book.assist`).
 */

/**
 * Keeps keyboard focus inside a helper when the control that had it goes
 * away (Stop once the answer is complete, the panel's own buttons): focus
 * moves to `target` instead of falling back to the page.
 */
export function useFocusRescue(
  root: RefObject<HTMLElement | null>,
  target: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let last: Element | null = null;
    const remember = (event: FocusEvent) => {
      last = event.target as Element;
    };
    node.addEventListener("focusin", remember);
    const watch = new MutationObserver(() => {
      if (!last || last.isConnected) return;
      last = null;
      const active = document.activeElement;
      if (!active || active === document.body)
        target.current?.focus({ preventScroll: true });
    });
    watch.observe(node, { childList: true, subtree: true });
    return () => {
      node.removeEventListener("focusin", remember);
      watch.disconnect();
    };
  }, [root, target]);
}

/** Focuses an element that may not take focus by itself (a heading, a status line). */
function focusStable(target: HTMLElement) {
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

/**
 * The section heading a helper sits under: the last heading of the
 * article before `node` (the chapter's title for the start of a chapter).
 */
export function headingBefore(node: HTMLElement): HTMLElement | null {
  const article = node.closest("article");
  if (!article) return null;
  let found: HTMLElement | null = null;
  for (const heading of article.querySelectorAll<HTMLElement>("h1, h2")) {
    if (
      heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
    )
      found = heading;
  }
  return found;
}

/**
 * The status line of the exercise a helper belongs to: its result line,
 * or, when that is empty (an SQLite error), the message of the run.
 */
export function exerciseStatusLine(node: HTMLElement): HTMLElement | null {
  const exercise = node.closest(".exercise");
  const result = exercise?.querySelector<HTMLElement>(".ex-result") ?? null;
  if (result?.textContent?.trim()) return result;
  return exercise?.querySelector<HTMLElement>(".sql-message") ?? result;
}

/**
 * When the assistant turns off (a request refused as disabled) with the
 * keyboard focus inside a helper, the whole helper leaves the page: focus
 * goes to a stable element next to it — `fallback` finds it, from the
 * helper's root, while the helper is still in the page — instead of
 * falling back to the start of the page. `fallback` must keep its identity
 * (a module-level function).
 */
export function useFocusHandoff(
  root: RefObject<HTMLElement | null>,
  fallback: (root: HTMLElement) => HTMLElement | null,
) {
  const { assist } = useReaderStores();
  // A layout effect's cleanup runs before the helper's nodes leave the DOM.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    return () => {
      if (assist.enabled || !node.contains(document.activeElement)) return;
      const target = fallback(node);
      if (!target) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        if (target.isConnected) focusStable(target);
      });
    };
  }, [root, fallback, assist]);
}

/** Names of an answer's code blocks: the book's language names, or "Code". */
export function useAnswerCodeLabels(): AnswerCodeLabels {
  const t = useTranslations("book.code");
  return {
    language: (lang) => {
      if (!lang) return t("code");
      const key = `languages.${lang}`;
      return t.has(key) ? t(key) : lang;
    },
    copy: t("copy"),
    copied: t("copied"),
    copyFailed: t("copyFailed"),
  };
}

/** When today's answers come back, in the reader's own time zone. */
function resetText(
  assist: AssistStore,
  locale: string,
  t: ReturnType<typeof useTranslations>,
) {
  const reset = assist.resetsAt();
  const now = new Date();
  const today =
    reset.getFullYear() === now.getFullYear() &&
    reset.getMonth() === now.getMonth() &&
    reset.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(reset);
  return t("resetsAt", { day: today ? "today" : "tomorrow", time });
}

/** Messages of the refusals that say all there is in one line. */
const failureKeys = {
  forbidden: "forbidden",
  "not-found": "notFound",
  invalid: "invalid",
  "too-large": "tooLarge",
} as const;

/** Why an answer failed, and what the reader can do about it. */
const FailureNote = observer(function FailureNote({
  failure,
}: {
  failure: AnswerFailure;
}) {
  "use no memo";
  const { assist } = useReaderStores();
  const t = useTranslations("book.assist");
  const locale = useLocale();
  const pathname = usePathname();
  switch (failure.kind) {
    case "daily-limit": {
      const when = resetText(assist, locale, t);
      return (
        <p className="assist-note" data-tone="error">
          {assist.quota
            ? t("dailyLimit", { limit: assist.quota.dailyLimit, when })
            : t("dailyLimitUnknown", { when })}
        </p>
      );
    }
    case "signed-out":
      return (
        <p className="assist-note" data-tone="error">
          {t("signedOut")}{" "}
          <a className="assist-link" href={signInHref(pathname || "/")}>
            {t("signIn")}
          </a>
        </p>
      );
    case "paused":
      return (
        <p className="assist-note" data-tone="error">
          {t("paused")}
        </p>
      );
    case "offline":
      return (
        <p className="assist-note" data-tone="error">
          {t("offline")}
        </p>
      );
    case "forbidden":
    case "not-found":
    case "invalid":
    case "too-large":
      return (
        <p className="assist-note" data-tone="error">
          {t(failureKeys[failure.kind])}
        </p>
      );
    default:
      return (
        <p className="assist-note" data-tone="error">
          {t("unavailable")}
        </p>
      );
  }
});

type AnswerViewProps = {
  answer: AnswerStore<AssistKind>;
  /** What the waiting line says ("The assistant is reading…"). */
  waiting: string;
  /** The answer's name (for the box when it scrolls). */
  label: string;
  /** More actions after the answer (another version, the score). */
  extra?: ReactNode;
  testId?: string;
};

/**
 * An answer: the waiting line (three dots that move only without reduced
 * motion), the text as it streams, then a note — cut at the length limit,
 * stopped, or why it failed — in a box whose height is reserved from the
 * moment of asking; under it Stop while it runs, Retry when that may help,
 * and the helper's own actions. The text is a polite live region that is
 * there (empty, taking no room) before the first request, so what comes in
 * is announced; while the text streams the region is busy, so the answer
 * is read once it is complete.
 */
export const AnswerView = observer(function AnswerView({
  answer,
  waiting,
  label,
  extra,
  testId,
}: AnswerViewProps) {
  "use no memo";
  const t = useTranslations("book.assist");
  const labels = useAnswerCodeLabels();
  const root = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  useFocusRescue(root, text);
  const { phase, failure, started } = answer;
  return (
    <div
      ref={root}
      className="assist-answer"
      data-phase={phase}
      data-started={started || undefined}
      data-testid={started ? testId : undefined}
    >
      <ScrollRegion className="assist-out" label={label}>
        <div
          ref={text}
          className="assist-text"
          tabIndex={-1}
          aria-live="polite"
          aria-busy={phase === "streaming" || undefined}
        >
          {phase === "waiting" ? (
            <p className="assist-wait">
              <span className="assist-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {waiting}
            </p>
          ) : null}
          {answer.text ? (
            <div className="assist-md">
              <AssistMarkdown text={answer.text} labels={labels} />
            </div>
          ) : null}
          {phase === "done" && answer.truncated ? (
            <p className="assist-note">{t("truncated")}</p>
          ) : null}
          {phase === "stopped" ? (
            <p className="assist-note">{t("stopped")}</p>
          ) : null}
          {phase === "failed" && failure ? (
            <FailureNote failure={failure} />
          ) : null}
        </div>
      </ScrollRegion>
      {started ? (
        <div className="assist-actions">
          {answer.running ? (
            <Button size="sm" variant="outline" onClick={answer.stop}>
              <StopCircleIcon aria-hidden="true" />
              {t("stop")}
            </Button>
          ) : null}
          {answer.canRetry ? (
            <Button size="sm" variant="outline" onClick={answer.retry}>
              <ArrowClockwiseIcon aria-hidden="true" />
              {t("retry")}
            </Button>
          ) : null}
          {answer.running ? null : extra}
        </div>
      ) : null}
    </div>
  );
});

/** "3 of 30 left today": the reader's answers left, once known. Keeps its line. */
export const AssistQuota = observer(function AssistQuota({
  className,
}: {
  className?: string;
}) {
  "use no memo";
  const { assist } = useReaderStores();
  const t = useTranslations("book.assist");
  const left = assist.remaining;
  return (
    <p
      className={className ? `assist-quota ${className}` : "assist-quota"}
      data-testid="assist-quota"
    >
      {left !== null && assist.quota
        ? t("remaining", { left, limit: assist.quota.dailyLimit })
        : null}
    </p>
  );
});
