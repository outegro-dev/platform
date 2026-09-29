import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuditFeed } from "@/components/audit/audit-feed";
import { FilterBar, Pager, SelectField, TextField } from "@/components/ui/data";
import { PageHeader, Panel } from "@/components/ui/layout";
import { RetryButton } from "@/components/ui/retry-button";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import {
  type AuditSource,
  auditSources,
  decodeMergeCursor,
  encodeMergeCursor,
  mergePage,
} from "@/lib/audit";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";
import { auditFetchers } from "@/lib/queries";
import { NotConnected } from "@/lib/result";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

type Filter = {
  source?: AuditSource;
  action?: string;
  targetId?: string;
  actorId?: string;
  cursor?: string;
};

async function Timeline({
  filter,
  granted,
}: {
  filter: Filter;
  granted: ReadonlySet<string>;
}) {
  const t = await getTranslations("audit");
  const all = auditFetchers(granted, {
    action: filter.action,
    targetId: filter.targetId,
    actorId: filter.actorId,
  });
  const sources = filter.source ? { [filter.source]: all[filter.source] } : all;
  const listed = Object.keys(sources).filter(
    (key) => sources[key as AuditSource],
  ) as AuditSource[];
  const { items, next, failed, unsupported } = await mergePage({
    sources,
    cursor: decodeMergeCursor(filter.cursor),
    limit: 30,
    unsupported: (error) => error instanceof NotConnected,
    matches: (entry) =>
      (!filter.action || entry.action === filter.action) &&
      (!filter.targetId || entry.targetId === filter.targetId) &&
      (!filter.actorId || entry.actorId === filter.actorId),
  });
  const names = t.raw("sources") as Record<string, string>;
  const available = listed.filter((source) => !unsupported.includes(source));
  const reading = t("reading", {
    sources:
      available.map((source) => names[source] ?? source).join(", ") || "—",
  });
  return (
    <Panel
      flush
      id="timeline"
      title={t("timeline")}
      note={
        unsupported.length > 0
          ? `${reading} · ${t("unsupported", { sources: unsupported.map((source) => names[source] ?? source).join(", ") })}`
          : reading
      }
    >
      {failed.length > 0 && (
        <div className="feed-padded">
          <div className="notice" data-tone="warn" role="status">
            <span style={{ flex: 1 }}>
              {t("partial", {
                sources: failed
                  .map((source) => names[source] ?? source)
                  .join(", "),
              })}
            </span>
            <RetryButton />
          </div>
        </div>
      )}
      {listed.length === 0 ? (
        <EmptyState title={t("noSources")} body={t("noSourcesBody")} />
      ) : items.length === 0 ? (
        <EmptyState
          search={Boolean(filter.action || filter.targetId || filter.actorId)}
          title={filter.cursor ? t("noMoreMatches") : t("empty")}
          body={t("emptyBody")}
        />
      ) : (
        <div className="feed-padded">
          <AuditFeed entries={items} />
        </div>
      )}
      <Pager
        path="/audit"
        params={{
          source: filter.source,
          action: filter.action,
          targetId: filter.targetId,
          actorId: filter.actorId,
          cursor: filter.cursor,
        }}
        nextCursor={next ? encodeMergeCursor(next) : null}
        shown={items.length}
      />
    </Panel>
  );
}

/** Every audited action across the platform in one timeline, newest first. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("audit.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("audit");
  const filter: Filter = {
    source: oneOf(params, "source", auditSources),
    action: one(params, "action")?.trim().slice(0, 100),
    targetId: one(params, "targetId")?.trim().slice(0, 100),
    actorId: uuidParam(params, "actorId"),
    cursor: one(params, "cursor"),
  };
  const names = t.raw("sources") as Record<string, string>;
  return (
    <div className="page">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} lead={t("lead")} />
      <Panel id="audit-filters">
        <FilterBar
          action="/audit"
          label={t("filters")}
          active={Boolean(
            filter.source || filter.action || filter.targetId || filter.actorId,
          )}
          inline
        >
          <SelectField
            name="source"
            label={t("source")}
            value={filter.source}
            allLabel={t("allSources")}
            options={auditSources.map((source) => ({
              value: source,
              label: names[source] ?? source,
            }))}
          />
          <TextField
            name="action"
            label={t("action")}
            value={filter.action}
            placeholder="role.granted"
            type="text"
          />
          <TextField
            name="targetId"
            label={t("target")}
            value={filter.targetId}
            placeholder={t("idPlaceholder")}
            type="text"
          />
          <TextField
            name="actorId"
            label={t("actor")}
            value={filter.actorId}
            placeholder={t("idPlaceholder")}
            type="text"
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(filter)}
        fallback={<PanelSkeleton label={t("timeline")} stats={0} rows={10} />}
      >
        <Timeline filter={filter} granted={access.granted} />
      </Suspense>
    </div>
  );
}
