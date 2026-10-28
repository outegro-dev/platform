import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Grm } from "@/components/roulette/bits";
import {
  DataTable,
  FilterBar,
  Pager,
  TextField,
  Time,
} from "@/components/ui/data";
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
  const t = await getTranslations("roulette.players");
  return { title: t("title") };
}

async function PlayersTable({ q, cursor }: { q?: string; cursor?: string }) {
  const t = await getTranslations("roulette.players");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().roulette.players({ q, cursor, limit: 25 }),
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
        <EmptyState
          search={Boolean(q)}
          title={q ? t("noMatch", { query: q }) : t("empty")}
          body={t("emptyBody")}
        />
      </Panel>
    );
  }
  return (
    <Panel
      flush
      id="players"
      title={q ? t("resultsFor", { query: q }) : t("listTitle")}
    >
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colPlayer")}</th>
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
              {t("colResult")}
            </th>
            <th scope="col">{t("colStatus")}</th>
            <th scope="col">{t("colLastBet")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((player) => (
            <tr key={player.userId}>
              <td data-primary="">
                <Link
                  href={`/roulette/players/${player.userId}`}
                  className="row-link cell-main"
                  prefetch={false}
                >
                  {player.nickname}
                </Link>
                <span className="cell-sub mono">
                  {player.userId.slice(0, 8)}
                </span>
              </td>
              <td data-label={t("colBets")} className="num">
                {f.number(player.bets)}
              </td>
              <td data-label={t("colStaked")} className="num">
                <Grm amount={player.staked} locale={f.locale} />
              </td>
              <td data-label={t("colPaidOut")} className="num">
                <Grm amount={player.paidOut} locale={f.locale} />
              </td>
              <td data-label={t("colResult")} className="num">
                <Grm amount={player.result} locale={f.locale} sign tone />
              </td>
              <td data-label={t("colStatus")}>
                <Status tone={toneOf("user", player.status)}>
                  {label("userStatus", player.status)}
                </Status>
              </td>
              <td data-label={t("colLastBet")}>
                <Time iso={player.lastBetAt} format="relative" />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/roulette/players"
        params={{ q, cursor }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

/** Players by turnover; a nickname finds one. */
export default async function PlayersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const q = one(params, "q")?.trim().slice(0, 64) || undefined;
  const cursor = one(params, "cursor")?.slice(0, 128);
  const t = await getTranslations("roulette.players");
  return (
    <>
      <Panel id="player-search" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/roulette/players"
          label={t("searchLabel")}
          active={Boolean(q)}
          inline
          submit="search"
        >
          <TextField
            name="q"
            label={t("searchField")}
            value={q}
            placeholder={t("searchPlaceholder")}
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={`${q ?? ""}|${cursor ?? ""}`}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <PlayersTable q={q} cursor={cursor} />
      </Suspense>
    </>
  );
}
