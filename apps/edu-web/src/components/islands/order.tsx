"use client";

import type { OrderBlock } from "@outegro/edu-engine";
import { Button } from "@outegro/ui/button";
import { ArrowCounterClockwiseIcon, PlusIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef } from "react";
import { OrderStore } from "@/stores/order-store";
import { useIslandStore } from "@/stores/provider";
import { createAttempt, shufflesOf } from "@/stores/reader-stores";
import {
  ExerciseFrame,
  Explanation,
  ResultLine,
  SaveLine,
  verdictTone,
} from "./exercise-parts";

/**
 * Put the items in order: pick them one by one from the options into your
 * order (a placed item goes back on a second click). With the last one
 * placed, every position shows whether it is right and where a wrong one
 * belongs, the explanation opens, and the server's verdict comes into the
 * result line. Focus follows the items, so it all works from the keyboard.
 */
export const Order = observer(function Order({
  order,
  items,
  question,
  explanation,
}: {
  /** The exercise as the engine checks it (question and explanation left out). */
  order: OrderBlock;
  /** In the right order; the reader gets them shuffled. */
  items: ReactNode[];
  question: ReactNode;
  explanation: ReactNode;
}) {
  "use no memo";
  const store = useIslandStore(
    (stores) =>
      new OrderStore(
        order,
        createAttempt(stores, order),
        shufflesOf(stores, order.id),
      ),
  );
  const t = useTranslations("book");
  const controls = useRef(new Map<string, HTMLElement>());
  const { focus, picked, pool, complete, score } = store;
  const verdict = store.attempt.verdict;
  const checking = verdict?.state === "checking";

  useEffect(() => {
    if (!focus) return;
    const target = controls.current.get(focus);
    if (!target) return;
    target.focus();
    store.focusDone();
  }, [focus, store]);

  const register = (key: string) => (node: HTMLElement | null) => {
    if (node) controls.current.set(key, node);
    else controls.current.delete(key);
  };

  const result = checking
    ? t("exercise.checking")
    : verdict?.state === "decided"
      ? verdict.correct
        ? t("order.allRight")
        : t("order.score", { right: score.right, total: score.total })
      : picked.length
        ? t("order.placed", { placed: picked.length, total: store.total })
        : null;

  return (
    <ExerciseFrame label={t("exercise.order")} id={order.id} className="order">
      <div className="ex-question">{question}</div>
      <div className="order-columns">
        <div className="order-column">
          <p className="order-heading">{t("order.pool")}</p>
          <ul className="order-list">
            {pool.length ? (
              pool.map((index) => (
                <li key={index}>
                  <button
                    ref={register(`pool-${index}`)}
                    type="button"
                    className="order-item"
                    onClick={() => store.pick(index)}
                  >
                    <span className="order-n" aria-hidden="true">
                      <PlusIcon aria-hidden="true" weight="bold" />
                    </span>
                    <span className="order-text">{items[index]}</span>
                  </button>
                </li>
              ))
            ) : (
              <li className="order-empty">{t("order.poolEmpty")}</li>
            )}
          </ul>
        </div>
        <div className="order-column">
          <p className="order-heading">{t("order.picked")}</p>
          <ol className="order-list">
            {picked.length ? (
              picked.map((index, position) => {
                const state = store.stateAt(position);
                return (
                  <li key={index}>
                    <button
                      ref={register(`picked-${index}`)}
                      type="button"
                      className="order-item"
                      data-state={state}
                      aria-disabled={complete || undefined}
                      onClick={() => store.unpick(position)}
                    >
                      <span className="order-n">{position + 1}</span>
                      <span className="order-text">{items[index]}</span>
                      {state === "wrong" ? (
                        <span className="order-fix">
                          {t("order.shouldBe", { position: index + 1 })}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="order-empty">{t("order.pickedEmpty")}</li>
            )}
          </ol>
        </div>
      </div>
      <div className="ex-actions">
        {complete ? (
          <Button
            ref={register("retry")}
            size="sm"
            variant="ghost"
            pending={checking}
            pendingLabel={t("exercise.checking")}
            onClick={store.retry}
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" />
            {t("order.again")}
          </Button>
        ) : (
          <span className="ex-hint">{t("order.hint")}</span>
        )}
      </div>
      <div className="ex-status">
        <ResultLine tone={verdictTone(verdict)}>{result}</ResultLine>
        <SaveLine saveKey={store.attempt.saveKey} />
      </div>
      {complete ? <Explanation>{explanation}</Explanation> : null}
    </ExerciseFrame>
  );
});
