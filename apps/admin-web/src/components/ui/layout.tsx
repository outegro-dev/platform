import { cn } from "@outegro/ui/lib/utils";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretRightIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

/** Page title block: optional breadcrumbs, eyebrow, lead and actions. */
export async function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  crumbs,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  crumbs?: { href: string; label: string }[];
}) {
  const t = await getTranslations("common");
  return (
    <header className="page-head">
      <div className="page-head-text">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label={t("breadcrumbs")} className="crumbs">
            {crumbs.map((crumb) => (
              <span key={crumb.href} className="row-gap" style={{ gap: 6 }}>
                <Link href={crumb.href}>{crumb.label}</Link>
                <CaretRightIcon aria-hidden="true" size={12} />
              </span>
            ))}
          </nav>
        )}
        {eyebrow && <p className="og-eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {lead && <p className="page-lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** A card section with a heading; `flush` for tables that run edge to edge. */
export function Panel({
  id,
  title,
  kicker,
  note,
  action,
  children,
  className,
  flush,
  kind,
}: {
  id?: string;
  title?: ReactNode;
  kicker?: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  flush?: boolean;
  kind?: "not-connected";
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      className={cn("panel", className)}
      aria-labelledby={title ? headingId : undefined}
      data-flush={flush ? "" : undefined}
      data-kind={kind}
    >
      {(title || kicker || action) && (
        <div className="panel-head">
          <div className="panel-heading">
            {kicker && <p className="panel-kicker">{kicker}</p>}
            {title && (
              <h2 className="panel-title" id={headingId}>
                {title}
              </h2>
            )}
            {note && <p className="panel-note">{note}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PanelLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="panel-link">
      {children}
      <ArrowRightIcon aria-hidden="true" />
    </Link>
  );
}

/** From a detail page back to its list, in the panel's head. */
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="panel-link" data-back="">
      <ArrowLeftIcon aria-hidden="true" />
      {children}
    </Link>
  );
}

/** Section tabs as links; the current one carries aria-current. */
export function SectionTabs({
  label,
  items,
  active,
}: {
  label: string;
  items: { key: string; href: string; label: string; count?: number }[];
  active: string;
}) {
  if (items.length < 2) return null;
  return (
    <nav aria-label={label} className="tabs">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="tab"
          aria-current={item.key === active ? "page" : undefined}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="tab-count">{item.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export type Fact = { label: ReactNode; value: ReactNode; key?: string };

export function Facts({ items, cols }: { items: Fact[]; cols?: 2 }) {
  return (
    <dl className="facts" data-cols={cols}>
      {items.map((item, index) => (
        <div key={item.key ?? index} className="fact">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  size,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ok" | "warn" | "bad";
  size?: "lg" | "sm";
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" data-tone={tone} data-size={size}>
        {value}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Status({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "neutral" | "live" | "info";
  children: ReactNode;
}) {
  return (
    <span className="status" data-tone={tone}>
      {children}
    </span>
  );
}

/** Horizontal breakdown bars with values, scaled to the largest (or `max`). */
export function Bars({
  items,
  max,
  label,
}: {
  items: {
    key: string;
    label: ReactNode;
    value: number;
    display?: ReactNode;
    tone?: "bad" | "ok" | "muted";
  }[];
  max?: number;
  label: string;
}) {
  const top = max ?? Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="bars" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="bar-row">
          <span className="bar-label">{item.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span
              className="bar-fill"
              data-tone={item.tone}
              style={{
                transform: `scaleX(${top > 0 ? Math.min(1, item.value / top) : 0})`,
              }}
            />
          </span>
          <span className="bar-value">{item.display ?? item.value}</span>
        </li>
      ))}
    </ul>
  );
}
