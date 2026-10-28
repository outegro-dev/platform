import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ColorChip, Grm } from "@/components/roulette/bits";
import { DataTable, Pager, Time } from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getLabels } from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roulette.rounds");
  return { title: t("title") };
}

async function RoundsTable({ cursor }: { cursor?: string }) {
  const t = await getTranslations("roulette.rounds");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().roulette.rounds({ cursor, limit: 25 }),
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
        <EmptyState title={t("empty")} body={t("emptyBody")} />
      </Panel>
    );
  }
  return (
    <Panel flush id="rounds" title={t("listTitle")} note={t("lead")}>
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colRound")}</th>
            <th scope="col">{t("colOutcome")}</th>
            <th scope="col" className="num">
              {t("colBets")}
            </th>
            <th scope="col" className="num">
              {t("colStaked")}
            </th>
            <th scope="col" className="num">
              {t("colPaidOut")}
            </th>
            <th scope="col" className="num">
              {t("colHouse")}
            </th>
            <th scope="col">{t("colOpened")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((round) => (
            <tr key={round.round}>
              <td data-primary="">
                <Link
                  href={`/roulette/rounds/${round.round}`}
                  className="row-link cell-main num"
                  prefetch={false}
                >
                  {t("roundNo", { round: round.round })}
                </Link>
              </td>
              <td data-label={t("colOutcome")}>
                {round.color !== null && round.number !== null ? (
                  <span className="row-gap" style={{ gap: 6 }}>
                    <ColorChip
                      color={round.color}
                      number={round.number}
                      label={label("rouletteColor", round.color)}
                    />
                    {round.phase === "voided" && (
                      <Status tone="bad">
                        {label("roulettePhase", round.phase)}
                      </Status>
                    )}
                  </span>
                ) : (
                  <Status tone={toneOf("roulettePhase", round.phase)}>
                    {label("roulettePhase", round.phase)}
                  </Status>
                )}
              </td>
              <td data-label={t("colBets")} className="num">
                {f.number(round.bets)}
              </td>
              <td data-label={t("colStaked")} className="num">
                <Grm amount={round.staked} locale={f.locale} />
              </td>
              <td data-label={t("colPaidOut")} className="num">
                <Grm amount={round.paidOut} locale={f.locale} />
              </td>
              <td data-label={t("colHouse")} className="num">
                <Grm amount={round.result} locale={f.locale} sign tone />
              </td>
              <td data-label={t("colOpened")}>
                <Time iso={round.openedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/roulette/rounds"
        params={{ cursor }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

/** Every round, newest first: the outcome, the bets and the house's result. */
export default async function RoundsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const cursor = one(params, "cursor")?.slice(0, 128);
  const t = await getTranslations("roulette.rounds");
  return (
    <Suspense
      key={cursor ?? ""}
      fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
    >
      <RoundsTable cursor={cursor} />
    </Suspense>
  );
}
