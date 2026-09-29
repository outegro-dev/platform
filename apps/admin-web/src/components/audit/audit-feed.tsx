import {
  BellIcon,
  BoatIcon,
  CreditCardIcon,
  FingerprintIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Time } from "@/components/ui/data";
import type { AuditSource, TimelineEntry } from "@/lib/audit";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";

const sourceIcons: Record<AuditSource, ReactNode> = {
  identity: <FingerprintIcon aria-hidden="true" />,
  notifications: <BellIcon aria-hidden="true" />,
  battleship: <BoatIcon aria-hidden="true" />,
  payments: <CreditCardIcon aria-hidden="true" />,
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
    case "settings":
      return "/notifications/channels";
    default:
      return null;
  }
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
  return (
    <ul className="feed">
      {entries.map((entry) => {
        const href = targetHref(entry);
        const target = `${label("target", entry.targetType)} ${shortId(entry.targetId)}`;
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
                {label("action", entry.action)}
                {" · "}
                {href ? (
                  <Link href={href} className="link">
                    {target}
                  </Link>
                ) : (
                  target
                )}
              </span>
              {entry.reason && (
                <span className="feed-meta">“{entry.reason}”</span>
              )}
              <span className="feed-meta">
                {entry.actorId ? (
                  <>
                    {t("by")}{" "}
                    <Link
                      href={`/users/${encodeURIComponent(entry.actorId)}`}
                      className="link mono"
                    >
                      {shortId(entry.actorId)}
                    </Link>
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
