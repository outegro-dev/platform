import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Grm } from "@/components/roulette/bits";
import { TableCommands } from "@/components/roulette/table-commands";
import { Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roulette.table");
  return { title: t("title") };
}

async function Table({ manage }: { manage: boolean }) {
  const t = await getTranslations("roulette.table");
  const f = await getFormatter();
  const result = await load(() => services().roulette.table());
  if (!result.ok) {
    return (
      <Panel
        id="table"
        title={t("title")}
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
  const table = result.data;
  return (
    <Panel
      id="table"
      title={t("title")}
      note={t("lead")}
      action={
        <span className="row-gap" style={{ gap: 6 }}>
          <Status tone={table.paused ? "warn" : "ok"}>
            {t(table.paused ? "betsPaused" : "betsOpen")}
          </Status>
          {table.maintenance && (
            <Status tone="warn">{t("inMaintenance")}</Status>
          )}
        </span>
      }
    >
      <Facts
        cols={2}
        items={[
          {
            key: "minBet",
            label: t("fields.minBet"),
            value: <Grm amount={table.minBet} locale={f.locale} />,
          },
          {
            key: "maxBet",
            label: t("fields.maxBet"),
            value: <Grm amount={table.maxBet} locale={f.locale} />,
          },
          {
            key: "betsPerRound",
            label: t("fields.betsPerRound"),
            value: <span className="num">{f.number(table.betsPerRound)}</span>,
          },
          {
            key: "payoutLimitPerColor",
            label: t("fields.payoutLimitPerColor"),
            value: <Grm amount={table.payoutLimitPerColor} locale={f.locale} />,
          },
          {
            key: "paused",
            label: t("fields.paused"),
            value: t(table.paused ? "on" : "off"),
          },
          {
            key: "maintenance",
            label: t("fields.maintenance"),
            value: t(table.maintenance ? "on" : "off"),
          },
          {
            key: "version",
            label: t("version"),
            value: (
              <span>
                <span className="num">{table.version}</span>
                {" · "}
                <Time iso={table.updatedAt} />
              </span>
            ),
          },
        ]}
      />
      {manage ? (
        <TableCommands settings={table} />
      ) : (
        <p className="small muted">{t("readOnly")}</p>
      )}
    </Panel>
  );
}

/** Limits, pausing bets and maintenance; changed with a preview and a reason. */
export default async function TablePage() {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("roulette.table");
  return (
    <Suspense
      fallback={<PanelSkeleton label={t("title")} stats={0} rows={7} />}
    >
      <Table manage={access.granted.has("roulette.manage")} />
    </Suspense>
  );
}
