"use client";

import { displayCell, MAX_ROWS, type SqlResult } from "@outegro/edu-engine";
import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { ArrowClockwiseIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, type Ref, useEffect, useRef } from "react";
import { useOnline } from "@/lib/browser";
import type { RunFailure } from "@/lib/sql/engine";
import { ScrollRegion } from "./scroll-region";

/**
 * The query editor: a plain textarea that behaves like a small code editor.
 * Ctrl/Cmd + Enter runs, Tab inserts two spaces, and Esc then Tab leaves
 * the editor (so the keyboard is never trapped in it).
 */
export function SqlEditor({
  id,
  value,
  onChange,
  onSubmit,
  label,
  describedBy,
  rows,
  ref,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  describedBy?: string;
  rows: number;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const escaped = useRef(false);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (event.key === "Escape") {
      escaped.current = true;
      return;
    }
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      if (escaped.current) {
        escaped.current = false;
        return;
      }
      event.preventDefault();
      const area = event.currentTarget;
      area.setRangeText("  ", area.selectionStart, area.selectionEnd, "end");
      onChange(area.value);
      return;
    }
    escaped.current = false;
  };

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        className="sql-editor"
        value={value}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </>
  );
}

/** Rows the editor shows for a query: its lines plus one, 3 to 16. */
export function editorRows(sql: string): number {
  return Math.min(16, Math.max(3, sql.split("\n").length + 1));
}

/**
 * A result table: column names, at most MAX_ROWS rows, NULL marked,
 * numbers aligned and rounded to 4 decimals, and the row count.
 */
export function SqlResultTable({
  result,
  caption,
}: {
  result: SqlResult;
  caption?: string;
}) {
  const t = useTranslations("book.sql");
  const count = result.values.length;
  const label = caption ?? t("yourResult");
  return (
    <div className="sql-result">
      {caption ? <p className="sql-caption">{caption}</p> : null}
      <ScrollRegion className="sql-table-wrap" label={label}>
        <table className="sql-table">
          <thead>
            <tr>
              {result.columns.map((column, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: SQL columns may share a name
                <th key={index} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.values.slice(0, MAX_ROWS).map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: result rows have no identity
              <tr key={rowIndex}>
                {row.map((value, index) => {
                  const cell = displayCell(value);
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells follow the columns
                    <td key={index} data-kind={cell.kind}>
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="sql-count">
        {t("rows", { count })}
        {count > MAX_ROWS ? `, ${t("rowsShown", { shown: MAX_ROWS })}` : ""}
      </p>
    </div>
  );
}

/** The message for a run that did not produce a result. */
export function useFailureText() {
  const t = useTranslations("book.sql");
  return (failure: RunFailure): string => {
    switch (failure.kind) {
      case "error":
        return t("error", { message: failure.message });
      case "timeout":
        return t("tooSlow");
      case "aborted":
        return t("tooHeavy");
      case "offline":
        return t("offline");
      default:
        return t("engineFailed");
    }
  };
}

/**
 * Tells a store when the connection comes back, so a run the offline
 * engine could not do runs then (`reconnected` does nothing otherwise).
 */
export function useReconnect(reconnected: () => void) {
  const online = useOnline();
  useEffect(() => {
    if (online) reconnected();
  }, [online, reconnected]);
}

/**
 * The engine could not load: the browser is offline. The run goes again
 * by itself once the connection is back, or with Retry.
 */
export function SqlOffline({
  onRetry,
  announce,
}: {
  onRetry: () => void;
  /** The reader asked for this run: the message is announced. */
  announce: boolean;
}) {
  const t = useTranslations("book.sql");
  return (
    <div className="sql-offline">
      <FormMessage
        className="sql-message"
        tone="error"
        lines={2}
        icon={<WifiSlashIcon aria-hidden="true" weight="bold" />}
        role={announce ? "alert" : undefined}
      >
        {t("offline")}
      </FormMessage>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <ArrowClockwiseIcon aria-hidden="true" />
        {t("retry")}
      </Button>
    </div>
  );
}

/**
 * The output of a run, from the first run on: a box of fixed height that
 * scrolls, so a result arriving after the engine's first download (or a
 * long one) never moves the page. While a run is under way the previous
 * output stays, dimmed.
 */
export function SqlOutput({
  label,
  stale,
  children,
}: {
  label: string;
  stale: boolean;
  children: React.ReactNode;
}) {
  return (
    <ScrollRegion className="sandbox-output" label={label}>
      <div className="sandbox-output-body" data-stale={stale || undefined}>
        {children}
      </div>
    </ScrollRegion>
  );
}
