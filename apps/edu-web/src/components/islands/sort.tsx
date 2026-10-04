"use client";

import type { SortBlock } from "@outegro/edu-engine";
import { Button } from "@outegro/ui/button";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef } from "react";
import { useIslandStore } from "@/stores/provider";
import { createAttempt, shufflesOf } from "@/stores/reader-stores";
import { SortStore } from "@/stores/sort-store";
import {
  ExerciseFrame,
  Explanation,
  ResultLine,
  SaveLine,
  verdictTone,
} from "./exercise-parts";

/**
 * Sort the items into buckets: one choice per item, and the first choice
 * counts (a wrong one shows where the item belongs). With every item
 * placed, the explanation opens and the server's verdict comes into the
 * result line.
 */
export const Sort = observer(function Sort({
  sort,
  question,
  buckets,
  items,
  explanation,
}: {
  /** The exercise as the engine checks it (question and explanation left out). */
  sort: SortBlock;
  question: ReactNode;
  buckets: { key: string; label: ReactNode }[];
  items: { content: ReactNode; text: string }[];
  explanation: ReactNode;
}) {
  "use no memo";
  const store = useIslandStore(
    (stores) =>
      new SortStore(
        sort,
        createAttempt(stores, sort),
        shufflesOf(stores, sort.id),
      ),
  );
  const t = useTranslations("book");
  const list = useRef<HTMLUListElement>(null);
  const { focus, score, started } = store;
  const verdict = store.attempt.verdict;
  const checking = verdict?.state === "checking";

  // "Start over" clears the answers: focus goes to the first choice.
  useEffect(() => {
    if (focus !== "first") return;
    list.current?.querySelector("button")?.focus();
    store.focusDone();
  }, [focus, store]);

  const result = checking
    ? t("exercise.checking")
    : score.complete
      ? t("sort.score", { right: score.right, total: score.total })
      : t("sort.progress", { done: score.done, total: score.total });

  return (
    <ExerciseFrame label={t("exercise.sort")} id={sort.id} className="sort">
      <div className="ex-question">{question}</div>
      <ul className="sort-rows" ref={list}>
        {store.order.map((itemIndex) => {
          const item = items[itemIndex];
          if (!item) return null;
          const answer = store.answerOf(itemIndex);
          return (
            <li
              key={itemIndex}
              className="sort-row"
              data-state={store.stateOf(itemIndex)}
            >
              <div className="sort-item">{item.content}</div>
              <fieldset
                className="sort-buckets"
                aria-label={`${t("sort.choices")}: ${item.text}`}
              >
                {buckets.map((bucket) => (
                  <button
                    key={bucket.key}
                    type="button"
                    className="sort-bucket"
                    data-mark={store.markOf(itemIndex, bucket.key)}
                    aria-pressed={
                      answer === undefined ? undefined : answer === bucket.key
                    }
                    aria-disabled={answer !== undefined || undefined}
                    onClick={() => store.choose(itemIndex, bucket.key)}
                  >
                    {bucket.label}
                  </button>
                ))}
              </fieldset>
            </li>
          );
        })}
      </ul>
      <div className="ex-actions">
        {started ? (
          <Button
            size="sm"
            variant="ghost"
            pending={checking}
            pendingLabel={t("exercise.checking")}
            onClick={store.retry}
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" />
            {t("sort.again")}
          </Button>
        ) : null}
      </div>
      <div className="ex-status">
        <ResultLine tone={score.complete ? verdictTone(verdict) : "neutral"}>
          {result}
        </ResultLine>
        <SaveLine saveKey={store.attempt.saveKey} />
      </div>
      {score.complete ? <Explanation>{explanation}</Explanation> : null}
    </ExerciseFrame>
  );
});
