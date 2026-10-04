"use client";

import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { Label } from "@outegro/ui/label";
import { Surface } from "@outegro/ui/surface";
import { SealCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { useIslandStore, useReaderStores } from "@/stores/provider";
import { createUnderstanding } from "@/stores/reader-stores";
import {
  MAX_RETELLING,
  MIN_RETELLING,
  type UnderstandingStore,
} from "@/stores/understanding-store";
import {
  AnswerView,
  AssistQuota,
  headingBefore,
  useFocusHandoff,
} from "./assist-parts";

/** The box's anchor: a link can point at it. */
export const OWN_WORDS_ID = "own-words";

/**
 * "Explain it in your own words" at the end of a chapter (before its
 * recap): the reader retells the chapter, the assistant compares it with
 * the chapter and grades it 1–10; the best grade of 7 or more confirms the
 * chapter is understood. There only while the assistant is known to be
 * on; when a request finds it off, the box leaves and the focus goes to
 * the heading of the section it closed.
 */
export const UnderstandingBox = observer(function UnderstandingBox({
  chapter,
  short,
}: {
  chapter: number;
  /** The chapter's short title, for the example in the field. */
  short: string;
}) {
  "use no memo";
  const { assist } = useReaderStores();
  if (!assist.enabled) return null;
  return <OwnWords chapter={chapter} short={short} />;
});

const OwnWords = observer(function OwnWords({
  chapter,
  short,
}: {
  chapter: number;
  short: string;
}) {
  "use no memo";
  const t = useTranslations("book.assist.ownWords");
  const root = useRef<HTMLDivElement>(null);
  useFocusHandoff(root, headingBefore);
  return (
    <Surface
      ref={root}
      className="exercise own-words"
      id={OWN_WORDS_ID}
      data-testid="own-words"
    >
      <p className="ex-label">
        <span>{t("label")}</span>
      </p>
      <p className="own-words-instruction">{t("instruction")}</p>
      <Retelling chapter={chapter} short={short} />
    </Surface>
  );
});

const Retelling = observer(function Retelling({
  chapter,
  short,
}: {
  chapter: number;
  short: string;
}) {
  "use no memo";
  const store = useIslandStore((stores) =>
    createUnderstanding(stores, chapter),
  );
  const t = useTranslations("book.assist");
  const field = useRef<HTMLTextAreaElement>(null);
  const { answer, problem, focusField } = store;

  // The draft lives in this browser: read once the page runs.
  useEffect(() => {
    store.restoreDraft();
  }, [store]);
  useEffect(() => () => store.answer.dispose(), [store]);
  useEffect(() => {
    if (focusField) field.current?.focus();
  }, [focusField]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      store.check();
    }
  };

  return (
    <>
      <BestScore store={store} />
      <Label htmlFor={`${OWN_WORDS_ID}-text`} className="sr-only">
        {t("ownWords.fieldLabel")}
      </Label>
      <textarea
        ref={field}
        id={`${OWN_WORDS_ID}-text`}
        className="assist-field own-words-field"
        rows={5}
        maxLength={MAX_RETELLING}
        placeholder={t("ownWords.placeholder", { short })}
        value={store.text}
        aria-describedby={`${OWN_WORDS_ID}-note`}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => store.setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <FormMessage
        id={`${OWN_WORDS_ID}-note`}
        className="assist-field-note"
        tone={problem ? "error" : "neutral"}
        lines={2}
        aria-live="polite"
      >
        {problem
          ? t("ownWords.tooShort", { min: MIN_RETELLING })
          : t("ownWords.hint")}
      </FormMessage>
      <div className="ex-actions own-words-actions">
        <Button
          size="sm"
          onClick={store.check}
          pending={answer.running}
          pendingLabel={t("ownWords.checking")}
        >
          <SparkleIcon aria-hidden="true" />
          {t("ownWords.check")}
        </Button>
        <AssistQuota className="own-words-quota" />
      </div>
      <AnswerView
        answer={answer}
        waiting={t("waitingUnderstanding")}
        label={t("answerLabel")}
        testId="own-words-answer"
        extra={
          store.score !== null ? (
            <Badge variant="solid" data-testid="understanding-score">
              {t("ownWords.score", { score: store.score })}
            </Badge>
          ) : null
        }
      />
    </>
  );
});

/**
 * The chapter's best score so far and, from 7 up, that it is understood.
 * One reserved line: a first score appears without moving anything.
 */
const BestScore = observer(function BestScore({
  store,
}: {
  store: UnderstandingStore;
}) {
  "use no memo";
  const t = useTranslations("book.assist.ownWords");
  const { best, understood } = store;
  return (
    <p
      className="own-words-best"
      data-understood={understood || undefined}
      data-testid="understanding-best"
    >
      {best !== null ? (
        <>
          {understood ? (
            <SealCheckIcon aria-hidden="true" weight="fill" />
          ) : null}
          {understood
            ? t("bestConfirmed", { score: best })
            : t("best", { score: best })}
        </>
      ) : null}
    </p>
  );
});
