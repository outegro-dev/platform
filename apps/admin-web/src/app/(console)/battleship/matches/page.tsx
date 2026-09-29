import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MatchesTable } from "@/components/battleship/matches-table";
import { FilterBar, SelectField, TextField } from "@/components/ui/data";
import { Panel } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { pageAccess } from "@/lib/access";
import {
  type MatchFilter,
  matchModes,
  matchStatuses,
} from "@/lib/adapters/battleship";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("battleship.matches");
  return { title: t("title") };
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("battleship.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("battleship.matches");
  const label = await getLabels();
  const filter: MatchFilter = {
    status: oneOf(params, "status", matchStatuses),
    mode: oneOf(params, "mode", matchModes),
    userId: uuidParam(params, "userId"),
    cursor: one(params, "cursor"),
  };
  return (
    <>
      <Panel id="match-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/battleship/matches"
          label={t("filters")}
          active={Boolean(filter.status || filter.mode || filter.userId)}
          inline
        >
          <SelectField
            name="status"
            label={t("status")}
            value={filter.status}
            allLabel={t("anyStatus")}
            options={matchStatuses.map((status) => ({
              value: status,
              label: label("matchStatus", status),
            }))}
          />
          <SelectField
            name="mode"
            label={t("mode")}
            value={filter.mode}
            allLabel={t("anyMode")}
            options={matchModes.map((mode) => ({
              value: mode,
              label: label("matchMode", mode),
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
        <MatchesTable filter={filter} title={t("listTitle")} />
      </Suspense>
    </>
  );
}
