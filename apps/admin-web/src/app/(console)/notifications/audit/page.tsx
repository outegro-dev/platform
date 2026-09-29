import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuditFeed } from "@/components/audit/audit-feed";
import { Pager } from "@/components/ui/data";
import { Panel } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { one, type SearchParams } from "@/lib/params";
import { load } from "@/lib/result";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.audit");
  return { title: t("title") };
}

async function Feed({ cursor }: { cursor?: string }) {
  const t = await getTranslations("notifications.audit");
  const result = await load(() =>
    services().notifications.audit({ cursor, limit: 25 }),
  );
  if (!result.ok) {
    return (
      <Panel>
        <FailureState failure={result} what={t("what")} />
      </Panel>
    );
  }
  const { items, nextCursor } = result.data;
  return (
    <Panel flush id="notifications-audit" title={t("title")} note={t("lead")}>
      {items.length === 0 ? (
        <EmptyState title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="feed-padded">
          <AuditFeed
            showSource={false}
            entries={items.map((entry) => ({
              ...entry,
              source: "notifications" as const,
              data: entry.data ?? {},
            }))}
          />
        </div>
      )}
      <Pager
        path="/notifications/audit"
        params={{ cursor }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function NotificationsAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("audit.read");
  if (!access.ok) return access.element;
  const cursor = one(await searchParams, "cursor");
  const t = await getTranslations("notifications.audit");
  return (
    <Suspense
      key={cursor ?? ""}
      fallback={<PanelSkeleton label={t("title")} stats={0} rows={8} />}
    >
      <Feed cursor={cursor} />
    </Suspense>
  );
}
