import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ReadersTable } from "@/components/education/readers-table";
import { FilterBar, SelectField, TextField } from "@/components/ui/data";
import { Panel } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { pageAccess } from "@/lib/access";
import type { ReaderFilter } from "@/lib/adapters/edu";
import { knownBook } from "@/lib/education";
import { one, type SearchParams, uuidParam } from "@/lib/params";
import { educationBooks } from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("education.readers");
  return { title: t("title") };
}

export default async function ReadersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("edu.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("education.readers");
  const books = await educationBooks();
  const filter: ReaderFilter = {
    book: knownBook(one(params, "book"), books),
    userId: uuidParam(params, "userId"),
    cursor: one(params, "cursor"),
  };
  return (
    <>
      <Panel id="reader-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/education/readers"
          label={t("filters")}
          active={Boolean(filter.book || filter.userId)}
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
          <TextField
            name="userId"
            label={t("userId")}
            value={filter.userId}
            placeholder={t("userIdPlaceholder")}
            type="text"
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(filter)}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <ReadersTable filter={filter} title={t("listTitle")} />
      </Suspense>
    </>
  );
}
