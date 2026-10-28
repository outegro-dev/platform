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
  const t = await getTranslations("roulette.audit");
  return { title: t("title") };
}

async function Feed({ cursor }: { cursor?: string }) {
  const t = await getTranslations("roulette.audit");
  const result = await load(() => services().roulette.audit({ cursor }));
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
    <Panel flush id="roulette-audit" title={t("title")} note={t("lead")}>
      {items.length === 0 ? (
        <EmptyState title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="feed-padded">
          <AuditFeed
            showSource={false}
            entries={items.map((entry) => ({
              ...entry,
              source: "roulette" as const,
            }))}
          />
        </div>
      )}
      <Pager
        path="/roulette/audit"
        params={{ cursor }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

/** Table changes and voided rounds, each with its operator and reason. */
export default async function RouletteAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const cursor = one(params, "cursor")?.slice(0, 128);
  const t = await getTranslations("roulette.audit");
  return (
    <Suspense
      key={cursor ?? ""}
      fallback={<PanelSkeleton label={t("title")} stats={0} rows={8} />}
    >
      <Feed cursor={cursor} />
    </Suspense>
  );
}
