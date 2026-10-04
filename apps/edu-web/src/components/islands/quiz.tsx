"use client";

import type { QuizBlock } from "@outegro/edu-engine";
import { Button } from "@outegro/ui/button";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef } from "react";
import { useIslandStore } from "@/stores/provider";
import { QuizStore } from "@/stores/quiz-store";
import { createAttempt } from "@/stores/reader-stores";
import {
  ExerciseFrame,
  Explanation,
  ResultLine,
  SaveLine,
  verdictTone,
} from "./exercise-parts";

/**
 * A question with options. One right answer: a click answers at once.
 * Several: options toggle and "Check" answers. The server's verdict comes
 * into the result line; the options' marks and the explanation (from the
 * book) show as soon as the reader answers, and "Answer again" resets.
 */
export const Quiz = observer(function Quiz({
  quiz,
  question,
  options,
  explanation,
}: {
  /** The exercise as the engine checks it (question and explanation left out). */
  quiz: QuizBlock;
  question: ReactNode;
  options: ReactNode[];
  explanation: ReactNode;
}) {
  "use no memo";
  const store = useIslandStore(
    (stores) => new QuizStore(quiz, createAttempt(stores, quiz)),
  );
  const t = useTranslations("book");
  const list = useRef<HTMLOListElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const { focusTarget, multiple, answered, result } = store;
  const verdict = store.attempt.verdict;
  const checking = verdict?.state === "checking";

  // "Check" keeps focus while the server checks; "Answer again" takes it
  // once it is there, and the first option once the answers are cleared.
  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === "options")
      list.current?.querySelector("button")?.focus();
    else again.current?.focus();
    store.focusDone();
  }, [focusTarget, store]);

  const markText = (index: number) => {
    const mark = store.markOf(index);
    if (mark === "right") return t("quiz.marks.right");
    if (mark === "missed")
      return multiple ? t("quiz.marks.alsoRight") : t("quiz.marks.theRight");
    if (mark === "wrong") return t("quiz.marks.wrong");
    return null;
  };
  const letters = t("quiz.letters");

  return (
    <ExerciseFrame
      label={multiple ? t("exercise.quizMulti") : t("exercise.quiz")}
      id={quiz.id}
      className="quiz"
    >
      <div className="ex-question">{question}</div>
      <ol className="quiz-options" ref={list}>
        {options.map((option, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: options never reorder
          <li key={index}>
            <button
              type="button"
              className="quiz-option"
              data-mark={store.markOf(index) ?? undefined}
              data-selected={
                (!answered && store.isSelected(index)) || undefined
              }
              aria-pressed={multiple ? store.isSelected(index) : undefined}
              aria-disabled={answered || undefined}
              onClick={() => store.choose(index)}
            >
              <span className="quiz-key" aria-hidden="true">
                {letters[index] ?? index + 1}
              </span>
              <span className="quiz-text">{option}</span>
              <span className="quiz-mark">{markText(index)}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="ex-actions">
        {multiple && (!answered || checking) ? (
          <>
            <Button
              size="sm"
              pending={checking}
              pendingLabel={t("exercise.checking")}
              aria-disabled={store.selected.size === 0 || undefined}
              onClick={store.check}
            >
              {t("exercise.check")}
            </Button>
            <span className="ex-hint">{t("quiz.pickAll")}</span>
          </>
        ) : null}
        {answered && !checking ? (
          <Button ref={again} size="sm" variant="ghost" onClick={store.reset}>
            <ArrowCounterClockwiseIcon aria-hidden="true" />
            {t("quiz.again")}
          </Button>
        ) : null}
      </div>
      <div className="ex-status">
        <ResultLine tone={verdictTone(verdict)}>
          {checking
            ? t("exercise.checking")
            : result
              ? t(`quiz.result.${result}`)
              : null}
        </ResultLine>
        <SaveLine saveKey={store.attempt.saveKey} />
      </div>
      {answered ? <Explanation>{explanation}</Explanation> : null}
    </ExerciseFrame>
  );
});
