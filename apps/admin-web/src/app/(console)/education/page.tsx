import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { EducationPanel } from "@/components/dashboard/education-panel";
import { AssistPanel } from "@/components/education/assist-panel";
import { BooksTable } from "@/components/education/books-table";
import { ReadersTable } from "@/components/education/readers-table";
import { Panel, PanelLink } from "@/components/ui/layout";
import { PanelSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { educationOverview } from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("education");
  return { title: t("title") };
}

/** One calm panel while Education is not connected, not one per section. */
async function WhenConnected({ children }: { children: ReactNode }) {
  const overview = await educationOverview();
  if (overview.ok || overview.kind !== "not-connected") return children;
  const t = await getTranslations("education.overview");
  return (
    <Panel id="connection" title={t("connection")} kind="not-connected">
      <FailureState
        failure={overview}
        what={t("what")}
        service={t("service")}
      />
    </Panel>
  );
}

export default async function EducationOverviewPage() {
  const access = await pageAccess("edu.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("education.overview");
  const assist = await getTranslations("education.assist");
  return (
    <Suspense
      fallback={
        <>
          <PanelSkeleton
            label={t("now")}
            chart
            rows={0}
            className="h-panel-md"
          />
          <PanelSkeleton label={assist("title")} stats={5} rows={3} />
        </>
      }
    >
      <WhenConnected>
        {/* Both read the one overview: they appear together, in place. */}
        <EducationPanel linked={false} />
        <AssistPanel />
        <Suspense
          fallback={
            <TableSkeleton label={t("books")} rows={2} withFilters={false} />
          }
        >
          <BooksTable title={t("books")} />
        </Suspense>
        <Suspense
          fallback={
            <TableSkeleton label={t("recent")} rows={6} withFilters={false} />
          }
        >
          <ReadersTable
            filter={{}}
            title={t("recent")}
            pager={false}
            limit={8}
            action={
              <PanelLink href="/education/readers">{t("allReaders")}</PanelLink>
            }
          />
        </Suspense>
      </WhenConnected>
    </Suspense>
  );
}
