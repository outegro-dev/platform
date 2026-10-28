"use client";

import type { ApplicationCard, Inbox } from "@outegro/contracts/atelier";
import { Button } from "@outegro/ui/button";
import {
  ArrowSquareOutIcon,
  CheckIcon,
  EnvelopeSimpleIcon,
  HandIcon,
  PencilSimpleIcon,
  TrayIcon,
  XIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  AgeLabel,
  FlagList,
  ScoreChip,
  useSourceLabel,
} from "@/components/board/parts";
import {
  useActionStatus,
  useFailureText,
} from "@/components/chrome/action-status";
import { isTyping } from "@/lib/browser";
import { writeApi } from "@/lib/client-api";
import { nextIndex } from "@/lib/inbox";
import { applicationHref } from "@/lib/routes";

const taskIcons = {
  needs_human: HandIcon,
  needs_edit: PencilSimpleIcon,
  unsorted_mail: EnvelopeSimpleIcon,
} as const;

/**
 * The Inbox: new matches to take or skip, from the keyboard too (J and K
 * move, Enter takes, X skips), and the tasks only the owner can do. A taken
 * or skipped match leaves the list at once; a refused one comes back.
 */
export function InboxView({ inbox, now }: { inbox: Inbox; now: number }) {
  const t = useTranslations("inbox");
  const boardT = useTranslations("board");
  const sourceLabel = useSourceLabel();
  const router = useRouter();
  const show = useActionStatus();
  const failureText = useFailureText();

  const [gone, setGone] = useState<string[]>([]);
  const [seen, setSeen] = useState(inbox);
  if (seen !== inbox) {
    setSeen(inbox);
    setGone([]);
  }
  const matches = inbox.matches.filter((card) => !gone.includes(card.id));
  const [active, setActive] = useState(0);
  const index = Math.min(active, Math.max(0, matches.length - 1));
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const focusRow = useRef(false);

  useEffect(() => {
    if (!focusRow.current) return;
    focusRow.current = false;
    rows.current[index]?.focus();
  });

  const decide = (card: ApplicationCard, take: boolean) => {
    setGone((current) => [...current, card.id]);
    focusRow.current = true;
    const write = take
      ? writeApi("POST", `/applications/${card.id}/stage`, {
          stage: "building",
        })
      : writeApi("POST", `/inbox/${card.id}/skip`, {});
    void write.then((result) => {
      if (result.ok) {
        show(
          take
            ? t("taken", { company: card.company })
            : t("skipped", { company: card.company }),
          "success",
        );
        router.refresh();
        return;
      }
      setGone((current) => current.filter((id) => id !== card.id));
      show(
        result.failure === "offline" || result.failure === "signed-out"
          ? failureText(result.failure)
          : t("failed", { company: card.company }),
        result.failure === "offline" ? "offline" : "error",
      );
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTyping(event.target)) return;
      if (document.querySelector("[role=dialog],[role=menu]")) return;
      const key = event.key.toLowerCase();
      const card = matches[index];
      if (key === "j" || key === "k") {
        event.preventDefault();
        setActive(nextIndex(index, matches.length, key === "j" ? 1 : -1));
        focusRow.current = true;
      } else if (key === "x" && card) {
        event.preventDefault();
        decide(card, false);
      } else if (
        key === "enter" &&
        card &&
        event.target instanceof HTMLElement &&
        event.target.dataset.row !== undefined
      ) {
        event.preventDefault();
        decide(card, true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="inbox">
      <section className="inbox-matches" aria-labelledby="inbox-matches">
        <header className="section-head">
          <h2 id="inbox-matches" className="section-title">
            {t("matches")}
            <span className="section-count">
              {t("matchesCount", { count: matches.length })}
            </span>
          </h2>
          <p className="keys">
            <span className="sr-only">{t("keys")}: </span>
            <span>
              <kbd>J</kbd>
              <kbd>K</kbd> {t("keyMove")}
            </span>
            <span>
              <kbd>Enter</kbd> {t("keyTake")}
            </span>
            <span>
              <kbd>X</kbd> {t("keySkip")}
            </span>
          </p>
        </header>
        {matches.length ? (
          <ol className="match-list" aria-label={t("listLabel")}>
            {matches.map((card, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are handled for the whole list (J, K, Enter, X).
              <li
                key={card.id}
                ref={(node) => {
                  rows.current[i] = node;
                }}
                className="match"
                data-row=""
                data-active={i === index || undefined}
                tabIndex={i === index ? 0 : -1}
                aria-labelledby={`match-${card.id}`}
                aria-describedby={`match-${card.id}-meta`}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
              >
                <ScoreChip score={card.score} size="lg" />
                <div className="match-body">
                  <h3 className="match-company" id={`match-${card.id}`}>
                    <Link
                      href={applicationHref(card.id)}
                      scroll={false}
                      prefetch={false}
                      tabIndex={i === index ? 0 : -1}
                    >
                      {card.company}
                    </Link>
                  </h3>
                  <p className="match-role">{card.role}</p>
                  <p className="match-meta" id={`match-${card.id}-meta`}>
                    {card.location ? <span>{card.location}</span> : null}
                    <span>{sourceLabel(card.source)}</span>
                    <AgeLabel iso={card.updatedAt} now={now} />
                  </p>
                  <FlagList flags={card.flags} label={boardT("flags")} />
                </div>
                <div className="match-actions">
                  <Button
                    size="sm"
                    tabIndex={i === index ? 0 : -1}
                    aria-keyshortcuts="Enter"
                    aria-label={t("takeNamed", { company: card.company })}
                    onClick={() => decide(card, true)}
                  >
                    <CheckIcon aria-hidden="true" weight="bold" />
                    {t("take")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    tabIndex={i === index ? 0 : -1}
                    aria-keyshortcuts="X"
                    aria-label={t("skipNamed", { company: card.company })}
                    onClick={() => decide(card, false)}
                  >
                    <XIcon aria-hidden="true" weight="bold" />
                    {t("skip")}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="inbox-empty">
            <TrayIcon aria-hidden="true" className="inbox-empty-icon" />
            <p className="inbox-empty-title">{t("empty")}</p>
            <p>{t("emptyBody")}</p>
          </div>
        )}
      </section>

      <section className="inbox-tasks" aria-labelledby="inbox-tasks">
        <header className="section-head">
          <h2 id="inbox-tasks" className="section-title">
            {t("tasks")}
            <span className="section-count">
              {t("tasksCount", { count: inbox.tasks.length })}
            </span>
          </h2>
        </header>
        {inbox.tasks.length ? (
          <ul className="task-list">
            {inbox.tasks.map((task) => {
              const Icon = taskIcons[task.kind];
              return (
                <li
                  key={`${task.applicationId}-${task.kind}`}
                  className="task"
                  data-kind={task.kind}
                >
                  <p className="task-kind">
                    <Icon aria-hidden="true" weight="bold" />
                    {t(`kinds.${task.kind}`)}
                  </p>
                  <h3 className="task-title">
                    {task.company}
                    <span className="task-role">{task.role}</span>
                  </h3>
                  <p className="task-reason">{task.reason}</p>
                  <div className="task-actions">
                    {task.kind === "needs_human" && task.url ? (
                      <Button asChild size="sm">
                        <a
                          href={task.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ArrowSquareOutIcon
                            aria-hidden="true"
                            weight="bold"
                          />
                          {t("openForm")}
                        </a>
                      </Button>
                    ) : null}
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={applicationHref(task.applicationId)}
                        scroll={false}
                        prefetch={false}
                      >
                        {t("openApplication")}
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{t("noTasks")}</p>
        )}
      </section>
    </div>
  );
}
