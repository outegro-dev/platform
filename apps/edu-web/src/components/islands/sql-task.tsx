"use client";

import type { SqlTaskBlock } from "@outegro/edu-engine";
import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { Surface } from "@outegro/ui/surface";
import {
  CheckIcon,
  LightbulbIcon,
  TextAlignLeftIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { SqlHint } from "@/components/assist/sql-hint";
import { CodeView } from "@/components/book/code-view";
import { useIslandStore } from "@/stores/provider";
import { createAttempt } from "@/stores/reader-stores";
import { SqlTaskStore, type WrongReason } from "@/stores/sql-task-store";
import { ExerciseFrame, ResultLine, SaveLine } from "./exercise-parts";
import {
  SqlEditor,
  SqlOffline,
  SqlOutput,
  SqlResultTable,
  useFailureText,
  useReconnect,
} from "./sql-parts";

/**
 * An SQL task. The reader's query runs in the browser; its result goes to
 * edu-backend, which compares it with the solution's (the server decides).
 * The solution also runs here, to say what differs: columns, rows, values
 * or order. Offline, the engine cannot load: the output says so, and the
 * check goes again once the connection is back. The draft stays in this
 * browser per task; the hint and the solution open and close.
 */
export const SqlTask = observer(function SqlTask({
  task,
  question,
  hint,
  solutionHtml,
}: {
  /** The task as the engine checks it (question left out). */
  task: SqlTaskBlock;
  question: ReactNode;
  hint: ReactNode | null;
  solutionHtml: string | null;
}) {
  "use no memo";
  const store = useIslandStore(
    (stores) =>
      new SqlTaskStore(task, createAttempt(stores, task), {
        runner: stores.services.sql,
        seed: stores.sandboxSeed,
        drafts: stores.services.storage,
        draftKey: `edu.sql.${stores.slug}.${task.id}`,
      }),
  );
  const t = useTranslations("book");
  const failureText = useFailureText();
  const domId = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
  const { run, busy, editorFocus } = store;
  const expected = store.expectedShown;

  // The draft lives in this browser: read once the page runs.
  useEffect(() => {
    store.restoreDraft();
  }, [store]);
  useReconnect(store.reconnected);

  useEffect(() => {
    if (editorFocus) editor.current?.focus();
  }, [editorFocus]);

  const outcome = store.outcome;
  const reasonText = (reason: WrongReason | null) => {
    if (!reason) return null;
    switch (reason.kind) {
      case "columns":
        return t("sql.columns", {
          mine: reason.mine,
          expected: reason.expected,
        });
      case "rows":
        return t("sql.rowsDiffer", {
          mine: reason.mine,
          expected: reason.expected,
        });
      case "values":
        return t("sql.values");
      case "order":
        return t("sql.order");
      case "no-result":
        return t("sql.noResultTask");
      case "reference-failed":
        return t("sql.referenceFailed", {
          message:
            reason.failure.kind === "error"
              ? reason.failure.message
              : failureText(reason.failure),
        });
    }
  };
  const result = !outcome
    ? null
    : outcome.kind === "checking"
      ? t("exercise.checking")
      : outcome.kind === "no-result"
        ? t("sql.noResultTask")
        : outcome.kind === "right"
          ? t("sql.right")
          : [t("sql.wrong"), reasonText(outcome.reason)]
              .filter(Boolean)
              .join(" ");
  const tone = !outcome
    ? "neutral"
    : outcome.kind === "checking"
      ? "pending"
      : outcome.kind === "right"
        ? "success"
        : "error";

  return (
    <ExerciseFrame
      label={t("exercise.sqlTask")}
      id={task.id}
      className="sql-task"
    >
      <div className="ex-question">{question}</div>
      <Surface className="sandbox sandbox-task">
        <SqlEditor
          ref={editor}
          id={`${domId}-sql`}
          value={store.query}
          onChange={store.setQuery}
          onSubmit={() => void store.check()}
          label={t("sql.editorLabel")}
          describedBy={`${domId}-keys`}
          rows={store.editorRows}
        />
        <div className="sandbox-actions">
          <Button
            size="sm"
            onClick={() => void store.check()}
            pending={busy}
            pendingLabel={t("exercise.checking")}
          >
            <CheckIcon aria-hidden="true" weight="bold" />
            {t("exercise.check")}
          </Button>
          {hint ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={store.toggleHint}
              aria-expanded={store.hintOpen}
              aria-controls={`${domId}-hint`}
            >
              <LightbulbIcon aria-hidden="true" />
              {t("sql.hint")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={store.toggleSolution}
            aria-expanded={store.solutionOpen}
            aria-controls={`${domId}-solution`}
          >
            <TextAlignLeftIcon aria-hidden="true" />
            {t("sql.showSolution")}
          </Button>
          <span className="ex-hint" id={`${domId}-keys`}>
            {t("sql.checkShortcut")} · {t("sql.leaveEditor")}
          </span>
        </div>
        {store.opened ? (
          <SqlOutput label={t("sql.output")} stale={busy}>
            {run?.kind === "result" ? (
              <>
                <SqlResultTable
                  result={run.mine}
                  caption={t("sql.yourResult")}
                />
                {expected ? (
                  <SqlResultTable
                    result={expected}
                    caption={t("sql.expectedResult")}
                  />
                ) : null}
              </>
            ) : run?.kind === "failed" && store.offline ? (
              <SqlOffline onRetry={() => void store.retry()} announce />
            ) : run?.kind === "failed" ? (
              <FormMessage
                className="sql-message"
                tone="error"
                lines={2}
                role="alert"
              >
                {failureText(run.failure)}
              </FormMessage>
            ) : (
              <FormMessage
                className="sql-message"
                tone={busy ? "pending" : "neutral"}
                lines={2}
              >
                {busy ? t("exercise.checking") : t("sql.noResult")}
              </FormMessage>
            )}
          </SqlOutput>
        ) : null}
      </Surface>
      <div className="ex-status">
        <ResultLine tone={tone}>{result}</ResultLine>
        <SaveLine saveKey={store.attempt.saveKey} />
      </div>
      <SqlHint task={store} />
      <div id={`${domId}-hint`} hidden={!store.hintOpen || !hint}>
        {store.hintOpen && hint ? (
          <div className="task-hint">{hint}</div>
        ) : null}
      </div>
      <div id={`${domId}-solution`} hidden={!store.solutionOpen}>
        {store.solutionOpen ? (
          <div className="task-solution">
            <CodeView
              code={task.solution}
              html={solutionHtml}
              label={t("sql.solutionTitle")}
              labels={{
                copy: t("code.copy"),
                copied: t("code.copied"),
                copyFailed: t("code.copyFailed"),
                output: t("code.output"),
              }}
            />
            <Button size="sm" variant="outline" onClick={store.insertSolution}>
              {t("sql.insertSolution")}
            </Button>
          </div>
        ) : null}
      </div>
    </ExerciseFrame>
  );
});
