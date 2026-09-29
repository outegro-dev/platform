import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
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
  const t = await getTranslations("battleship.players");
  return { title: t("title") };
}

async function PlayersTable({
  query,
  cursor,
}: {
  query?: string;
  cursor?: string;
}) {
  const t = await getTranslations("battleship.players");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().battleship.players({ query, cursor, limit: 25 }),
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
          search={Boolean(query)}
          title={query ? t("noMatch", { query }) : t("empty")}
          body={t("emptyBody")}
        />
      </Panel>
    );
  }
  return (
    <Panel
      flush
      id="players"
      title={query ? t("resultsFor", { query }) : t("listTitle")}
    >
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colPlayer")}</th>
            <th scope="col" className="num">
              {t("colRating")}
            </th>
            <th scope="col" className="num">
              {t("colMatches")}
            </th>
            <th scope="col" className="num">
              {t("colRecord")}
            </th>
            <th scope="col">{t("colStatus")}</th>
            <th scope="col">{t("colJoined")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((player) => (
            <tr key={player.userId}>
              <td data-primary="">
                <span className="row-gap" style={{ gap: 8 }}>
                  <span
                    className="dot"
                    data-tone={player.online ? "ok" : undefined}
                    aria-hidden="true"
                  />
                  <Link
                    href={`/battleship/players/${player.userId}`}
                    className="row-link cell-main"
                    prefetch={false}
                  >
                    {player.nickname}
                  </Link>
                  {player.online && (
                    <span className="sr-only">{t("online")}</span>
                  )}
                </span>
                <span className="cell-sub mono">
                  {player.userId.slice(0, 8)}
                </span>
              </td>
              <td data-label={t("colRating")} className="num">
                {f.number(player.rating)}
              </td>
              <td data-label={t("colMatches")} className="num">
                {f.number(player.matches)}
              </td>
              <td data-label={t("colRecord")} className="num">
                {f.number(player.wins)}–{f.number(player.losses)}
              </td>
              <td data-label={t("colStatus")}>
                <span className="row-gap" style={{ gap: 6 }}>
                  <Status tone={toneOf("player", player.status)}>
                    {label("userStatus", player.status)}
                  </Status>
                  {player.leaderboardHidden && (
                    <Status tone="warn">{t("hidden")}</Status>
                  )}
                </span>
              </td>
              <td data-label={t("colJoined")}>
                <Time iso={player.createdAt} format="date" />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/battleship/players"
        params={{ query, cursor }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("battleship.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const query = one(params, "query")?.trim().slice(0, 64) || undefined;
  const cursor = one(params, "cursor");
  const t = await getTranslations("battleship.players");
  return (
    <>
      <Panel id="player-search" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/battleship/players"
          label={t("searchLabel")}
          active={Boolean(query)}
          inline
          submit="search"
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
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <PlayersTable query={query} cursor={cursor} />
      </Suspense>
    </>
  );
}
