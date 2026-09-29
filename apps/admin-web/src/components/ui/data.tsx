import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import {
  CaretDoubleLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react/dist/ssr";
import Form from "next/form";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { maskEmailsIn } from "@/lib/format";
import { getFormatter } from "@/lib/request";

/** A date in the operator's language and time zone; exact UTC on hover. */
export async function Time({
  iso,
  format = "dateTime",
}: {
  iso: string | null | undefined;
  format?: "dateTime" | "date" | "relative";
}) {
  if (!iso) return <span className="muted">—</span>;
  const f = await getFormatter();
  const text =
    format === "relative"
      ? f.relative(iso)
      : format === "date"
        ? f.date(iso)
        : f.dateTime(iso);
  return (
    <time dateTime={iso} title={f.utc(iso)} className="nowrap">
      {text}
    </time>
  );
}

/**
 * A scrollable, keyboard-reachable table. On phones each row becomes a
 * labelled card (cells carry `data-label`).
 */
export function DataTable({
  label,
  children,
  stack = true,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  stack?: boolean;
  /** Few short columns: no minimum width in narrow panels. */
  compact?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
    <section className="table-wrap" aria-label={label} tabIndex={0}>
      <table
        className="table"
        data-stack={stack ? "" : undefined}
        data-compact={compact ? "" : undefined}
      >
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </section>
  );
}

/** Cursor pagination: back to the first page, or on to the next one. */
export async function Pager({
  path,
  params,
  nextCursor,
  shown,
}: {
  path: string;
  params: Record<string, string | undefined>;
  nextCursor: string | null;
  shown: number;
}) {
  const t = await getTranslations("common");
  const base = Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) => key !== "cursor" && value !== undefined && value !== "",
    ),
  ) as Record<string, string>;
  const onFirst = !params.cursor;
  const href = (cursor?: string) => {
    const query = new URLSearchParams(base);
    if (cursor) query.set("cursor", cursor);
    const search = query.toString();
    return search ? `${path}?${search}` : path;
  };
  if (onFirst && !nextCursor) {
    return (
      <div className="pager">
        <span>{t("shown", { count: shown })}</span>
      </div>
    );
  }
  return (
    <nav className="pager" aria-label={t("pagination")}>
      <span>{t("shown", { count: shown })}</span>
      <div className="pager-actions">
        {!onFirst && (
          <Button asChild variant="ghost" size="sm">
            <Link href={href()}>
              <CaretDoubleLeftIcon aria-hidden="true" />
              {t("firstPage")}
            </Link>
          </Button>
        )}
        {nextCursor && (
          <Button asChild variant="outline" size="sm">
            <Link href={href(nextCursor)} rel="next">
              {t("nextPage")}
              <CaretRightIcon aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </nav>
  );
}

/**
 * Filters live in the URL (shareable, back-button friendly): a GET form that
 * navigates client-side, with a reset link when anything is set.
 */
export async function FilterBar({
  action,
  label,
  active,
  children,
  inline,
}: {
  action: string;
  label: string;
  active: boolean;
  children: ReactNode;
  inline?: boolean;
}) {
  const t = await getTranslations("common");
  return (
    <Form
      action={action}
      className="filters"
      data-inline={inline ? "" : undefined}
      role="search"
      aria-label={label}
    >
      {children}
      <div className="filter-actions">
        <Button type="submit" size="md">
          {t("apply")}
        </Button>
        {active && (
          <Button asChild variant="ghost" size="md">
            <Link href={action}>{t("reset")}</Link>
          </Button>
        )}
      </div>
    </Form>
  );
}

export function SelectField({
  name,
  label,
  value,
  options,
  allLabel,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  const id = `filter-${name}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} className="select">
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextField({
  name,
  label,
  value,
  placeholder,
  type = "search",
}: {
  name: string;
  label: string;
  value: string | undefined;
  placeholder?: string;
  type?: "search" | "text" | "date";
}) {
  const id = `filter-${name}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

/** Pretty JSON; addresses masked unless the operator may see them. */
export function JsonView({
  value,
  label,
  mask = true,
}: {
  value: unknown;
  label: string;
  mask?: boolean;
}) {
  const text = JSON.stringify(value ?? null, null, 2);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: long payloads scroll; the keyboard must reach them.
    <section className="code" aria-label={label} tabIndex={0}>
      <pre>{mask ? maskEmailsIn(text) : text}</pre>
    </section>
  );
}
