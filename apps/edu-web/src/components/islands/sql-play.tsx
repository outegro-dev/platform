"use client";

import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { Surface } from "@outegro/ui/surface";
import { ArrowCounterClockwiseIcon, PlayIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type MouseEvent, useId, useRef } from "react";
import { useIslandStore } from "@/stores/provider";
import { SqlSandboxStore } from "@/stores/sql-sandbox-store";
import {
  editorRows,
  SqlEditor,
  SqlOffline,
  SqlOutput,
  SqlResultTable,
  useFailureText,
  useReconnect,
} from "./sql-parts";
import { useWhenNear } from "./use-near";

/** A press of a control that says it is unavailable (aria-disabled) does nothing. */
const ignore = (event: MouseEvent) => event.preventDefault();

/**
 * A query the reader can edit and run on the book's training database
 * (SQLite in a worker, a fresh copy for every run). It runs once by itself
 * when it first comes near the screen (the engine is downloaded only then,
 * through the page's one worker queue), so its result is waiting for the
 * reader. The result is the last statement's rows, in an output box that
 * is there from the start and keeps its size: nothing moves when it fills.
 * Offline, the engine cannot load: the box says so, and the run goes again
 * once the connection is back.
 */
export const SqlPlay = observer(function SqlPlay({ sql }: { sql: string }) {
  "use no memo";
  const store = useIslandStore(
    (stores) =>
      new SqlSandboxStore(sql, {
        runner: stores.services.sql,
        seed: stores.sandboxSeed,
      }),
  );
  const t = useTranslations("book.sql");
  const failureText = useFailureText();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const { output, running, busy } = store;
  useWhenNear(root, store.runFirst);
  useReconnect(store.reconnected);

  // Only the reader's own runs are announced: the first, automatic ones
  // of every sandbox near the screen would talk over the page.
  const status = !store.announced
    ? ""
    : running
      ? t("running")
      : store.rows !== null
        ? t("rows", { count: store.rows })
        : output?.kind === "empty"
          ? t("noResult")
          : "";

  return (
    <Surface className="sandbox" ref={root}>
      <div className="sandbox-head">
        <p className="sandbox-title">{t("sandbox")}</p>
        <p className="sandbox-note">{t("sandboxNote")}</p>
      </div>
      <SqlEditor
        id={`${id}-sql`}
        value={store.query}
        onChange={store.setQuery}
        onSubmit={() => void store.run()}
        label={t("editorLabel")}
        describedBy={`${id}-keys`}
        rows={editorRows(sql)}
      />
      <div className="sandbox-actions">
        {/* Busy for the reader's own runs; during the automatic first run a
            press is kept and goes next. */}
        <Button
          size="sm"
          onClick={() => void store.run()}
          pending={busy}
          pendingLabel={t("running")}
        >
          <PlayIcon aria-hidden="true" weight="fill" />
          {t("run")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-disabled={busy || undefined}
          onClick={busy ? ignore : store.reset}
        >
          <ArrowCounterClockwiseIcon aria-hidden="true" />
          {t("reset")}
        </Button>
        <span className="ex-hint" id={`${id}-keys`}>
          {t("runShortcut")} · {t("leaveEditor")}
        </span>
      </div>
      <p className="sr-only" role="status">
        {status}
      </p>
      <SqlOutput label={t("output")} stale={running && output !== null}>
        {output?.kind === "result" ? (
          <SqlResultTable result={output.result} />
        ) : output?.kind === "empty" ? (
          <FormMessage className="sql-message" tone="neutral" lines={2}>
            {t("noResult")}
          </FormMessage>
        ) : output?.kind === "failed" && store.offline ? (
          <SqlOffline
            onRetry={() => void store.run()}
            announce={store.announced}
          />
        ) : output?.kind === "failed" ? (
          <FormMessage
            className="sql-message"
            tone="error"
            lines={2}
            role={store.announced ? "alert" : undefined}
          >
            {failureText(output.failure)}
          </FormMessage>
        ) : store.opened ? (
          <FormMessage className="sql-message" tone="pending" lines={2}>
            {t("running")}
          </FormMessage>
        ) : null}
      </SqlOutput>
    </Surface>
  );
});
