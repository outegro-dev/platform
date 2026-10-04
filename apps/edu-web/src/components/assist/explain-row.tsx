"use client";

import { type AssistStyle, assistStyleSchema } from "@outegro/contracts/edu";
import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { Label } from "@outegro/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import {
  ArrowsClockwiseIcon,
  ChatTeardropTextIcon,
  PaperPlaneRightIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef } from "react";
import type { ExplainPanelStore } from "@/stores/explain-panel-store";
import { useIslandStore, useReaderStores } from "@/stores/provider";
import { createExplainPanel } from "@/stores/reader-stores";
import {
  AnswerView,
  AssistQuota,
  headingBefore,
  useFocusHandoff,
} from "./assist-parts";

const styles = assistStyleSchema.options;

/**
 * "Explain it differently" under a section heading: a disclosure button,
 * and the panel it opens (kept, with its answer, when closed again). There
 * only while the assistant is known to be on: a page without its status
 * (signed out) has none, and when a request finds it off, the row leaves
 * and the focus goes to the section's heading.
 */
export const ExplainRow = observer(function ExplainRow({
  chapter,
  section,
}: {
  chapter: number;
  /** The section's anchor (its heading's id): the request's `section`. */
  section: string;
}) {
  "use no memo";
  const { assist } = useReaderStores();
  if (!assist.enabled) return null;
  return <ExplainDisclosure chapter={chapter} section={section} />;
});

const ExplainDisclosure = observer(function ExplainDisclosure({
  chapter,
  section,
}: {
  chapter: number;
  section: string;
}) {
  "use no memo";
  const store = useIslandStore((stores) =>
    createExplainPanel(stores, chapter, section),
  );
  const t = useTranslations("book.assist");
  const root = useRef<HTMLDivElement>(null);
  const panelId = `${section}-assist`;
  useFocusHandoff(root, headingBefore);

  // Leaving the page drops an answer still coming.
  useEffect(() => () => store.answer.dispose(), [store]);

  return (
    <div ref={root} className="assist-explain">
      <div className="assist-row">
        <Button
          size="sm"
          variant="outline"
          className="assist-toggle"
          aria-expanded={store.open}
          aria-controls={panelId}
          onClick={store.toggle}
        >
          <ChatTeardropTextIcon aria-hidden="true" />
          {t("explainButton")}
        </Button>
      </div>
      <div
        id={panelId}
        className="assist-panel"
        hidden={!store.open}
        data-testid="assist-panel"
      >
        {store.mounted ? <ExplainPanel store={store} /> : null}
      </div>
    </div>
  );
});

/** Ways to explain, the reader's own question, the answer and today's quota. */
const ExplainPanel = observer(function ExplainPanel({
  store,
}: {
  store: ExplainPanelStore;
}) {
  "use no memo";
  const t = useTranslations("book.assist");
  const locale = useLocale();
  const field = useRef<HTMLTextAreaElement>(null);
  const ids = `${store.section}-assist`;
  const { answer, asked, focusQuestion, questionProblem } = store;

  useEffect(() => {
    if (focusQuestion) field.current?.focus();
  }, [focusQuestion]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      store.askQuestion();
    }
  };

  const what =
    asked?.kind === "style"
      ? t(`style.${asked.style}`).toLocaleLowerCase(locale)
      : t("questionWhat");

  return (
    <div className="assist-panel-body">
      <p className="assist-intro">{t("explainIntro")}</p>
      <ToggleGroup
        type="single"
        variant="chip"
        size="sm"
        className="assist-styles"
        aria-label={t("styles")}
        value={store.style ?? ""}
        onValueChange={(value) => {
          if (value) store.chooseStyle(value as AssistStyle);
        }}
      >
        {styles.map((style) => (
          <ToggleGroupItem key={style} value={style}>
            {t(`style.${style}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="assist-ask">
        <Label htmlFor={`${ids}-question`} className="sr-only">
          {t("questionLabel")}
        </Label>
        <textarea
          ref={field}
          id={`${ids}-question`}
          className="assist-field"
          rows={2}
          maxLength={500}
          placeholder={t("questionPlaceholder")}
          value={store.question}
          aria-describedby={`${ids}-question-note`}
          aria-invalid={questionProblem ? true : undefined}
          onChange={(event) => store.setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button size="sm" onClick={store.askQuestion}>
          <PaperPlaneRightIcon aria-hidden="true" />
          {t("ask")}
        </Button>
      </div>
      <FormMessage
        id={`${ids}-question-note`}
        className="assist-field-note"
        tone={questionProblem ? "error" : "neutral"}
        lines={1}
        aria-live="polite"
      >
        {questionProblem ? t("questionShort") : t("askShortcut")}
      </FormMessage>
      <AnswerView
        answer={answer}
        waiting={t("waitingExplain", { what })}
        label={t("answerLabel")}
        testId="assist-answer"
        extra={
          store.canAgain ? (
            <Button size="sm" variant="outline" onClick={store.again}>
              <ArrowsClockwiseIcon aria-hidden="true" />
              {t("again")}
            </Button>
          ) : null
        }
      />
      <AssistQuota />
    </div>
  );
});
