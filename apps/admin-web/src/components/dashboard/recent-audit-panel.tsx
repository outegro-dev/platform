import { getTranslations } from "next-intl/server";
import { AuditFeed } from "@/components/audit/audit-feed";
import { Panel, PanelLink } from "@/components/ui/layout";
import { RetryButton } from "@/components/ui/retry-button";
import { EmptyState } from "@/components/ui/states";
import { mergePage } from "@/lib/audit";
import { auditFetchers } from "@/lib/queries";
import { NotConnected } from "@/lib/result";

/** The latest actions from every audit feed the operator may read. */
export async function RecentAuditPanel({
  granted,
}: {
  granted: ReadonlySet<string>;
}) {
  const t = await getTranslations("dashboard.audit");
  const sources = t.raw("sources") as Record<string, string>;
  const { items, failed } = await mergePage({
    sources: auditFetchers(granted),
    cursor: {},
    limit: 5,
    unsupported: (error) => error instanceof NotConnected,
  });
  return (
    <Panel
      id="recent-audit"
      kicker={t("kicker")}
      title={t("title")}
      className="h-panel-sm"
      action={<PanelLink href="/audit">{t("open")}</PanelLink>}
    >
      {failed.length > 0 && (
        <div className="notice" data-tone="warn" role="status">
          <span style={{ flex: 1 }}>
            {t("partial", {
              sources: failed
                .map((source) => sources[source] ?? source)
                .join(", "),
            })}
          </span>
          <RetryButton />
        </div>
      )}
      {items.length > 0 ? (
        <AuditFeed entries={items} />
      ) : failed.length === 0 ? (
        <EmptyState size="sm" title={t("empty")} body={t("emptyBody")} />
      ) : null}
    </Panel>
  );
}
