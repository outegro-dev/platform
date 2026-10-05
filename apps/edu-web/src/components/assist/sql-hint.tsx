"use client";

import { Button } from "@outegro/ui/button";
import { QuestionIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { useIslandStore, useReaderStores } from "@/stores/provider";
import { createSqlHint } from "@/stores/reader-stores";
import type { SqlHintStore } from "@/stores/sql-hint-store";
import type { SqlTaskStore } from "@/stores/sql-task-store";
import {
  AnswerView,
  AssistQuota,
  exerciseStatusLine,
  useFocusHandoff,
} from "./assist-parts";

/**
 * "Ask what is wrong" under an SQL task, from its first check on: a row of
 * its own (reserved, so the offer appears without moving anything) with
 * the button after a failed check — an SQLite error, no result, or a
 * result unlike the solution's — and today's answers left beside it, and
 * the hint streaming below once asked. There only while the assistant is
 * known to be on; when a request finds it off, the row leaves and the
 * focus goes to the task's result line.
 */
export const SqlHint = observer(function SqlHint({
  task,
}: {
  task: SqlTaskStore;
}) {
  "use no memo";
  const { assist } = useReaderStores();
  if (!assist.enabled || !task.opened) return null;
  return <SqlHintRow task={task} />;
});

const SqlHintRow = observer(function SqlHintRow({
  task,
}: {
  task: SqlTaskStore;
}) {
  "use no memo";
  const hint = useIslandStore((stores) => createSqlHint(stores, task));
  const root = useRef<HTMLDivElement>(null);
  useFocusHandoff(root, exerciseStatusLine);
  // Follows the task's checks while the row is on the page.
  useEffect(() => {
    hint.start();
    return () => hint.stop();
  }, [hint]);
  const asking = hint.offered || hint.answer.started;
  return (
    <div ref={root} className="task-assist-wrap">
      <div className="task-assist" data-testid="sql-hint">
        {hint.offered ? <AskButton hint={hint} /> : null}
        {asking ? <AssistQuota /> : null}
      </div>
      <HintAnswer hint={hint} />
    </div>
  );
});

const AskButton = observer(function AskButton({
  hint,
}: {
  hint: SqlHintStore;
}) {
  "use no memo";
  const t = useTranslations("book.assist");
  return (
    <Button
      size="sm"
      variant="outline"
      aria-disabled={hint.used || undefined}
      onClick={hint.ask}
    >
      <QuestionIcon aria-hidden="true" />
      {t("sqlHint")}
    </Button>
  );
});

const HintAnswer = observer(function HintAnswer({
  hint,
}: {
  hint: SqlHintStore;
}) {
  "use no memo";
  const t = useTranslations("book.assist");
  return (
    <AnswerView
      answer={hint.answer}
      waiting={t("waitingSql")}
      label={t("answerLabel")}
      testId="sql-hint-answer"
    />
  );
});
