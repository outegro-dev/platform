import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuditFeed } from "@/components/audit/audit-feed";
import { FilterBar, Pager, SelectField } from "@/components/ui/data";
import { Panel } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { knownBook } from "@/lib/education";
import { one, type SearchParams } from "@/lib/params";
import { educationBooks } from "@/lib/queries";
import { load } from "@/lib/result";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("education.audit");
  return { title: t("title") };
}

type Filter = { book?: string; cursor?: string };

async function Feed({ filter }: { filter: Filter }) {
  const t = await getTranslations("education.audit");
  const result = await load(() =>
    services().education.audit({
      targetId: filter.book,
      cursor: filter.cursor,
      limit: 25,
    }),
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
  return (
    <Panel flush id="education-audit" title={t("listTitle")}>
      {items.length === 0 ? (
        <EmptyState
          search={Boolean(filter.book)}
          title={t("empty")}
          body={t("emptyBody")}
        />
      ) : (
        <div className="feed-padded">
          <AuditFeed
            showSource={false}
            entries={items.map((entry) => ({
              ...entry,
              source: "education" as const,
            }))}
          />
        </div>
      )}
      <Pager
        path="/education/audit"
        params={filter}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

/** Status and access changes with their reasons, and every content import. */
export default async function EducationAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("edu.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("education.audit");
  const books = await educationBooks();
  const filter: Filter = {
    book: knownBook(one(params, "book"), books),
    cursor: one(params, "cursor"),
  };
  return (
    <>
      <Panel id="education-audit-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/education/audit"
          label={t("filters")}
          active={Boolean(filter.book)}
          inline
        >
          <SelectField
            name="book"
            label={t("book")}
            value={filter.book}
            allLabel={t("anyBook")}
            options={(books.ok ? books.data : []).map((item) => ({
              value: item.slug,
              label: item.title,
            }))}
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(filter)}
        fallback={<PanelSkeleton label={t("listTitle")} stats={0} rows={8} />}
      >
        <Feed filter={filter} />
      </Suspense>
    </>
  );
}
