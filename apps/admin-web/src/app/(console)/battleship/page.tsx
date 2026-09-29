import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MatchesTable } from "@/components/battleship/matches-table";
import { BattleshipPanel } from "@/components/dashboard/battleship-panel";
import { PanelSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { pageAccess } from "@/lib/access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("battleship");
  return { title: t("title") };
}

export default async function BattleshipOverviewPage() {
  const access = await pageAccess("battleship.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("battleship.overview");
  return (
    <>
      <Suspense
        fallback={
          <PanelSkeleton label={t("now")} rows={3} className="h-panel-md" />
        }
      >
        <BattleshipPanel linked={false} />
      </Suspense>
      <Suspense
        fallback={
          <TableSkeleton label={t("live")} rows={4} withFilters={false} />
        }
      >
        <MatchesTable
          filter={{ status: "battle" }}
          title={t("live")}
          pager={false}
          limit={8}
        />
      </Suspense>
      <Suspense
        fallback={
          <TableSkeleton label={t("recent")} rows={6} withFilters={false} />
        }
      >
        <MatchesTable
          filter={{ status: "finished" }}
          title={t("recent")}
          pager={false}
          limit={8}
        />
      </Suspense>
    </>
  );
}
