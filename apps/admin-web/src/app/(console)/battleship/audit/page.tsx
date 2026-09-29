import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuditFeed } from "@/components/audit/audit-feed";
import { FilterBar, Pager, SelectField, TextField } from "@/components/ui/data";
import { Panel } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams } from "@/lib/params";
import { load } from "@/lib/result";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("battleship.audit");
  return { title: t("title") };
}

type Filter = {
  targetType?: "match" | "player";
  targetId?: string;
  cursor?: string;
};

async function Feed({ filter }: { filter: Filter }) {
  const t = await getTranslations("battleship.audit");
  const result = await load(() =>
    services().battleship.audit({ ...filter, limit: 25 }),
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
    <Panel flush id="battleship-audit" title={t("listTitle")}>
      {items.length === 0 ? (
        <EmptyState title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="feed-padded">
          <AuditFeed
            showSource={false}
            entries={items.map((entry) => ({
              ...entry,
              source: "battleship" as const,
            }))}
          />
        </div>
      )}
      <Pager
        path="/battleship/audit"
        params={filter}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function BattleshipAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("battleship.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("battleship.audit");
  const label = await getLabels();
  const filter: Filter = {
    targetType: oneOf(params, "targetType", ["match", "player"] as const),
    targetId: one(params, "targetId")?.slice(0, 64),
    cursor: one(params, "cursor"),
  };
  return (
    <>
      <Panel id="battleship-audit-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/battleship/audit"
          label={t("filters")}
          active={Boolean(filter.targetType || filter.targetId)}
          inline
        >
          <SelectField
            name="targetType"
            label={t("targetType")}
            value={filter.targetType}
            allLabel={t("anyTarget")}
            options={(["match", "player"] as const).map((type) => ({
              value: type,
              label: label("target", type),
            }))}
          />
          <TextField
            name="targetId"
            label={t("targetId")}
            value={filter.targetId}
            type="text"
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
