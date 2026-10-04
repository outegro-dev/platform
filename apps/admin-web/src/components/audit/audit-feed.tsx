import {
  ArrowRightIcon,
  BellIcon,
  BoatIcon,
  BookOpenTextIcon,
  CreditCardIcon,
  FingerprintIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import {
  getRuleWords,
  type RuleWords,
} from "@/components/education/access-rule";
import { Time } from "@/components/ui/data";
import { type AccessRule, isEduAuditAction } from "@/lib/adapters/edu";
import type { AuditSource, TimelineEntry } from "@/lib/audit";
import { bookChangeOf } from "@/lib/education";
import { shortId } from "@/lib/format";
import { getLabels, type Label } from "@/lib/labels";
import { Actor } from "./actor";

const sourceIcons: Record<AuditSource, ReactNode> = {
  identity: <FingerprintIcon aria-hidden="true" />,
  notifications: <BellIcon aria-hidden="true" />,
  battleship: <BoatIcon aria-hidden="true" />,
  payments: <CreditCardIcon aria-hidden="true" />,
  education: <BookOpenTextIcon aria-hidden="true" />,
};

/** Where a target lives in the console, when it has a page. */
export function targetHref(
  entry: Pick<TimelineEntry, "source" | "targetType" | "targetId">,
) {
  const id = encodeURIComponent(entry.targetId);
  switch (entry.targetType) {
    case "user":
      return `/users/${id}`;
    case "delivery":
      return `/notifications/deliveries/${id}`;
    case "match":
      return `/battleship/matches/${id}`;
    case "player":
      return `/battleship/players/${id}`;
    case "order":
      return `/payments/orders/${id}`;
    case "book":
      return `/education/books/${id}`;
    case "settings":
      // Only Notifications' settings have a page.
      return entry.source === "notifications"
        ? "/notifications/channels"
        : null;
    default:
      return null;
  }
}

/**
 * A book's content import runs with Education's migrations: no actor and no
 * reason, but the content version it brought (null for any other entry).
 */
function contentImport(
  entry: TimelineEntry,
): { version: number | null } | null {
  if (entry.actorId || entry.action !== "book.imported") return null;
  const version = entry.data.contentVersion;
  return { version: typeof version === "number" ? version : null };
}

/**
 * An Education action newer than this console (the contract does not name
 * it): a generic entry with the action's code instead of a guessed name.
 */
const unknownAction = (entry: TimelineEntry) =>
  entry.source === "education" && !isEduAuditAction(entry.action);

/**
 * A book's status or access rule before and after the change, in the
 * operator's words; null when the entry does not carry both.
 */
function changeWords(
  entry: TimelineEntry,
  label: Label,
  words: (rule: AccessRule, slug: string) => RuleWords,
): { before: string; after: string } | null {
  if (entry.source !== "education") return null;
  const change = bookChangeOf(entry);
  if (!change) return null;
  if (change.kind === "status")
    return {
      before: label("bookStatus", change.before),
      after: label("bookStatus", change.after),
    };
  // A paid rule needs its features and free chapters to tell two apart.
  const rule = (value: AccessRule) => {
    const said = words(value, entry.targetId);
    return value.mode === "grant"
      ? `${said.title} · ${said.summary}`
      : said.title;
  };
  return { before: rule(change.before), after: rule(change.after) };
}

export async function SourceBadge({ source }: { source: AuditSource }) {
  const t = await getTranslations("audit.sources");
  return (
    <span className="source-badge">
      {sourceIcons[source]}
      {t(source)}
    </span>
  );
}

/** Audit entries: who did what to which record, why, and when. */
export async function AuditFeed({
  entries,
  showSource = true,
}: {
  entries: TimelineEntry[];
  showSource?: boolean;
}) {
  const t = await getTranslations("audit");
  const label = await getLabels();
  const words = await getRuleWords();
  return (
    <ul className="feed">
      {entries.map((entry) => {
        const href = targetHref(entry);
        // Settings are one record each ("channels"), not an ID to shorten;
        // a book's slug is its readable name.
        const target =
          entry.targetType === "settings"
            ? label("settingsTarget", entry.targetId)
            : `${label("target", entry.targetType)} ${
                entry.targetType === "book"
                  ? entry.targetId
                  : shortId(entry.targetId)
              }`;
        const imported = contentImport(entry);
        const unknown = unknownAction(entry);
        const change = unknown ? null : changeWords(entry, label, words);
        return (
          <li
            key={`${entry.source}-${entry.id}`}
            className="feed-item"
            data-plain={showSource ? undefined : ""}
          >
            {showSource && (
              <span className="feed-source">
                <SourceBadge source={entry.source} />
              </span>
            )}
            <span className="feed-main">
              <span className="feed-title">
                {unknown ? t("otherAction") : label("action", entry.action)}
                {" · "}
                {href ? (
                  <Link href={href} className="link">
                    {target}
                  </Link>
                ) : (
                  target
                )}
              </span>
              {unknown && (
                <span className="feed-meta">
                  {t("actionCode")} <span className="mono">{entry.action}</span>
                </span>
              )}
              {/* Seen as "Published → Draft", heard as "was …, now …". */}
              {change && (
                <span className="feed-meta feed-change">
                  <span className="sr-only">{t("was")} </span>
                  <span>{change.before}</span>
                  <ArrowRightIcon aria-hidden="true" />
                  <span className="sr-only">, {t("now")} </span>
                  <span className="feed-change-after">{change.after}</span>
                </span>
              )}
              {entry.reason && (
                <span className="feed-meta">“{entry.reason}”</span>
              )}
              <span className="feed-meta">
                {entry.actorId ? (
                  <>
                    {t("by")} <Actor id={entry.actorId} />
                  </>
                ) : imported ? (
                  <>
                    {t("byImport")}
                    {imported.version !== null &&
                      ` · ${t("contentVersion", { version: imported.version })}`}
                  </>
                ) : (
                  t("bySystem")
                )}
              </span>
            </span>
            <span className="feed-time">
              <Time iso={entry.createdAt} format="relative" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
