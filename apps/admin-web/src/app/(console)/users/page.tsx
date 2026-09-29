import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";
import { FilterBar, TextField } from "@/components/ui/data";
import { PageHeader, Panel } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { UsersTable } from "@/components/users/users-table";
import { pageAccess } from "@/lib/access";
import { one, type SearchParams } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("title") };
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("users.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const query = one(params, "query")?.trim() || undefined;
  const cursor = one(params, "cursor");
  // A user id goes straight to the card.
  if (query && z.uuid().safeParse(query).success) redirect(`/users/${query}`);
  const t = await getTranslations("users");
  return (
    <div className="page">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} lead={t("lead")} />
      <Panel>
        <FilterBar
          action="/users"
          label={t("searchLabel")}
          active={Boolean(query)}
          inline
        >
          <TextField
            name="query"
            label={t("searchField")}
            value={query}
            placeholder={t("searchPlaceholder")}
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={`${query ?? ""}|${cursor ?? ""}`}
        fallback={<TableSkeleton label={t("title")} withFilters={false} />}
      >
        <UsersTable
          query={query}
          cursor={cursor}
          sensitive={access.granted.has("users.read.sensitive")}
        />
      </Suspense>
    </div>
  );
}
