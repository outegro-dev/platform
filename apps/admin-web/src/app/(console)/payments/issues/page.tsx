import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  FilterBar,
  JsonView,
  Pager,
  SelectField,
  TextField,
  Time,
} from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.issues");
  return { title: t("title") };
}

type Filter = { status?: "open" | "resolved"; kind?: string; cursor?: string };

/** Discrepancies found by reconciliation, with their evidence. */
async function IssuesList({
  filter,
  sensitive,
}: {
  filter: Filter;
  sensitive: boolean;
}) {
  const t = await getTranslations("payments.issues");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().payments.issues({ ...filter, limit: 25 }),
  );
  if (!result.ok) {
    return (
      <Panel
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const { items, nextCursor } = result.data;
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          title={filter.status === "open" ? t("noneOpen") : t("empty")}
          body={t("emptyBody")}
        />
      </Panel>
    );
  }
  return (
    <Panel flush id="issues" title={t("listTitle")}>
      <ul className="feed feed-padded">
        {items.map((issue) => (
          <li key={issue.id} className="feed-item" data-plain="">
            <div className="feed-main">
              <span className="feed-title row-gap">
                <Status tone={toneOf("severity", issue.severity)}>
                  {label("severity", issue.severity)}
                </Status>
                {label("issueKind", issue.kind)}
                <Status tone={toneOf("issue", issue.status)}>
                  {label("issueStatus", issue.status)}
                </Status>
              </span>
              <span className="feed-meta mono">{issue.subjectKey}</span>
              <span className="feed-meta">
                {t("seen", { count: issue.occurrences })} · {t("first")}{" "}
                <Time iso={issue.firstSeenAt} /> · {t("last")}{" "}
                <Time iso={issue.lastSeenAt} />
              </span>
              {issue.resolution && (
                <span className="feed-meta">
                  {t("resolution")} “{issue.resolution}” ·{" "}
                  <Time iso={issue.resolvedAt} />
                </span>
              )}
              <details className="stack-sm">
                <summary
                  className="link small"
                  style={{ cursor: "pointer", width: "fit-content" }}
                >
                  {t("evidence")}
                </summary>
                <div className="grid-2">
                  <JsonView
                    value={issue.related}
                    label={t("related")}
                    mask={!sensitive}
                  />
                  <JsonView
                    value={issue.evidence}
                    label={t("evidence")}
                    mask={!sensitive}
                  />
                </div>
              </details>
            </div>
            <span className="feed-time">{f.relative(issue.lastSeenAt)}</span>
          </li>
        ))}
      </ul>
      <Pager
        path="/payments/issues"
        params={filter}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("payments.issues");
  const label = await getLabels();
  const filter: Filter = {
    status: oneOf(params, "status", ["open", "resolved"] as const),
    kind: one(params, "kind")?.slice(0, 64),
    cursor: one(params, "cursor"),
  };
  return (
    <>
      <Panel id="issue-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/payments/issues"
          label={t("filters")}
          active={Boolean(filter.status || filter.kind)}
          inline
        >
          <SelectField
            name="status"
            label={t("status")}
            value={filter.status}
            allLabel={t("anyStatus")}
            options={(["open", "resolved"] as const).map((status) => ({
              value: status,
              label: label("issueStatus", status),
            }))}
          />
          <TextField
            name="kind"
            label={t("kind")}
            value={filter.kind}
            type="text"
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(filter)}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <IssuesList
          filter={filter}
          sensitive={access.granted.has("users.read.sensitive")}
        />
      </Suspense>
    </>
  );
}
