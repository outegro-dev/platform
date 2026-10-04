"use client";

import type { DeckChapter, DeckFilter, DeckMode } from "@outegro/edu-engine";
import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { Label } from "@outegro/ui/label";
import { Surface } from "@outegro/ui/surface";
import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";
import { InlineText } from "@/components/book/inline";
import { signInHref } from "@/lib/routes";
import { DeckStore } from "@/stores/deck-store";
import { useIslandStore, useReaderStores } from "@/stores/provider";
import { type LineTone, SAVE_MESSAGE } from "./exercise-parts";

const modes: DeckMode[] = ["all", "new", "again"];
const modeKeys = {
  all: "modeAll",
  new: "modeNew",
  again: "modeAgain",
} as const;
const emptyKeys = {
  done: "done",
  "none-open": "noneOpen",
  "none-again": "noneAgain",
  "none-new": "noneNew",
  "none-here": "noneHere",
} as const;

/**
 * Every flash card of the chapters the reader can open, one at a time:
 * answer aloud, show the answer, then mark it "I know it" or "Again". A
 * chapter filter, new / again sets, a meter of known, again and new cards,
 * and one line on the saves of every mark made here.
 */
export const Deck = observer(function Deck({
  chapters,
}: {
  chapters: DeckChapter[];
}) {
  "use no memo";
  const store = useIslandStore(
    (stores) =>
      new DeckStore(chapters, {
        progress: stores.progress,
        sync: stores.sync,
        first: stores.firstShuffle(`${stores.slug}:deck`),
        random: stores.services.random,
      }),
  );
  const t = useTranslations("book.deck");
  const filterId = useId();
  const controls = useRef<Record<string, HTMLElement | null>>({});
  const { counts, current, shown, focus, empty } = store;

  useEffect(() => {
    if (!focus) return;
    const target = controls.current[focus];
    if (!target) return;
    target.focus();
    store.focusDone();
  }, [focus, store]);

  const share = (value: number) => (counts.total ? value / counts.total : 0);

  return (
    <Surface className="deck">
      <div className="deck-bar">
        <div className="deck-filter">
          <Label className="deck-filter-label" htmlFor={filterId}>
            {t("chapter")}
          </Label>
          <select
            id={filterId}
            value={String(store.filter)}
            onChange={(event) => {
              const value = event.target.value;
              const next: DeckFilter = value === "all" ? "all" : Number(value);
              store.setFilter(next);
            }}
          >
            <option value="all">
              {t("allChapters", { count: store.cards.length })}
            </option>
            {chapters.map((chapter) => (
              <option key={chapter.n} value={chapter.n}>
                {t("chapterOption", { n: chapter.n, short: chapter.short })}
              </option>
            ))}
          </select>
        </div>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          className="deck-modes"
          aria-label={t("modes")}
          value={store.mode}
          onValueChange={(value) => store.setMode(value as DeckMode)}
        >
          {modes.map((mode) => (
            <ToggleGroupItem key={mode} value={mode}>
              {t(modeKeys[mode])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div
        className="deck-meter"
        role="img"
        aria-label={t("meter", {
          know: counts.know,
          again: counts.again,
          fresh: counts.fresh,
        })}
      >
        <span
          data-kind="know"
          style={{ transform: `scaleX(${share(counts.know)})` }}
        />
        <span
          data-kind="again"
          style={{
            transform: `translateX(${share(counts.know) * 100}%) scaleX(${share(counts.again)})`,
          }}
        />
      </div>
      <dl className="deck-stats" data-testid="deck-stats">
        <div>
          <dt>{t("know")}</dt>
          <dd data-testid="deck-know">{counts.know}</dd>
        </div>
        <div>
          <dt>{t("again")}</dt>
          <dd data-testid="deck-again">{counts.again}</dd>
        </div>
        <div>
          <dt>{t("fresh")}</dt>
          <dd data-testid="deck-new">{counts.fresh}</dd>
        </div>
      </dl>
      <div className="deck-card" aria-live="polite">
        {current ? (
          <>
            <p className="deck-source">
              {t("position", {
                chapter: t("chapterOption", {
                  n: current.chapter,
                  short: current.short,
                }),
                index: store.position,
                total: store.queue.length,
              })}
            </p>
            <p className="deck-question">
              <InlineText nodes={current.front} />
            </p>
            {shown ? (
              <div className="deck-answer">
                <InlineText nodes={current.back} />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="deck-question">
              {empty ? t(emptyKeys[empty]) : null}
            </p>
            <p className="deck-source">{t("restartHint")}</p>
          </>
        )}
      </div>
      <div className="deck-actions">
        {current && !shown ? (
          <>
            <Button
              ref={(node) => {
                controls.current.show = node;
              }}
              onClick={store.show}
            >
              <EyeIcon aria-hidden="true" />
              {t("show")}
            </Button>
            <Button variant="ghost" onClick={store.skip}>
              {t("skip")}
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </>
        ) : null}
        {current && shown ? (
          <>
            <Button
              ref={(node) => {
                controls.current.know = node;
              }}
              onClick={() => store.mark("know")}
            >
              <CheckIcon aria-hidden="true" weight="bold" />
              {t("know")}
            </Button>
            <Button variant="secondary" onClick={() => store.mark("again")}>
              <ArrowClockwiseIcon aria-hidden="true" />
              {t("again")}
            </Button>
          </>
        ) : null}
        {current ? null : (
          <Button
            ref={(node) => {
              controls.current.restart = node;
            }}
            onClick={store.restart}
          >
            <ArrowClockwiseIcon aria-hidden="true" />
            {t("reshuffle")}
          </Button>
        )}
      </div>
      <DeckSaveLine
        store={store}
        statusRef={(node) => {
          controls.current.status = node;
        }}
      />
    </Surface>
  );
});

/**
 * Where the marks made here stand: saving, saved, or how many did not
 * reach the account and why — a retry for those that may still get
 * there, sign-in when the session ended, a note when the server refused
 * some (those marks were undone). One reserved line for every mark; it
 * takes the focus when its Retry button goes away under it.
 */
const DeckSaveLine = observer(function DeckSaveLine({
  store,
  statusRef,
}: {
  store: DeckStore;
  statusRef: (node: HTMLParagraphElement | null) => void;
}) {
  "use no memo";
  const { signedIn } = useReaderStores();
  const t = useTranslations("book.save");
  const pathname = usePathname();
  if (!signedIn) return null;
  const saves = store.saves;
  let text: string | null = null;
  let tone: LineTone = "neutral";
  if (saves.unsaved) {
    text = saves.offline
      ? t("cardsOffline", { count: saves.unsaved })
      : t("cardsUnsaved", { count: saves.unsaved });
    tone = "error";
  } else if (saves.signedOut) {
    text = t("cardsSignedOut");
    tone = "error";
  } else if (saves.refused) {
    text = t("cardsRefused", { count: saves.refused });
    tone = "error";
  } else if (saves.saving) {
    text = t("saving");
    tone = "pending";
  } else if (saves.saved) {
    text = t("saved");
    tone = "success";
  }
  return (
    <div className="save-line deck-save" data-testid="deck-save">
      <FormMessage
        ref={statusRef}
        tabIndex={-1}
        className={SAVE_MESSAGE}
        tone={tone}
        lines={2}
        icon={
          saves.offline ? (
            <WifiSlashIcon aria-hidden="true" weight="bold" />
          ) : undefined
        }
        aria-live="polite"
        data-testid="save-status"
      >
        {text}
      </FormMessage>
      {saves.unsaved ? (
        <Button
          size="sm"
          variant="outline"
          className="save-action"
          onClick={store.retryUnsaved}
        >
          <ArrowClockwiseIcon aria-hidden="true" />
          {t("retry")}
        </Button>
      ) : null}
      {!saves.unsaved && saves.signedOut ? (
        <Button asChild size="sm" variant="link" className="save-action">
          <a href={signInHref(pathname || "/")}>{t("signIn")}</a>
        </Button>
      ) : null}
    </div>
  );
});
