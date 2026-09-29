import {
  ArrowLeftIcon,
  EyeIcon,
  EyeSlashIcon,
  PencilSimpleSlashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  resetNickname,
  setLeaderboardVisibility,
} from "@/app/(console)/battleship/actions";
import { MatchesTable } from "@/components/battleship/matches-table";
import { ActionDialog } from "@/components/ui/action-dialog";
import { LineChart } from "@/components/ui/charts";
import { DataTable, Time } from "@/components/ui/data";
import { Bars, Facts, Panel, Stat, Status } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { botLevels } from "@/lib/adapters/battleship";
import { getLabels } from "@/lib/labels";
import type { Params } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("battleship.player");
  return { title: t("title") };
}

export default async function PlayerPage({ params }: { params: Params<"id"> }) {
  const access = await pageAccess("battleship.read");
  if (!access.ok) return access.element;
  const { id } = await params;
  const t = await getTranslations("battleship.player");
  const label = await getLabels();
  const f = await getFormatter();
  const back = (
    <Link
      href="/battleship/players"
      className="panel-link"
      style={{ margin: 0 }}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {t("back")}
    </Link>
  );
  const result = await load(() => services().battleship.player(id));
  if (!result.ok) {
    return (
      <Panel
        action={back}
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
  const { player, stats, ratingHistory, grants } = result.data;
  const moderate = access.granted.has("battleship.moderate");
  const history = [...ratingHistory].reverse();

  return (
    <>
      <Panel
        id="player"
        kicker={t("kicker")}
        title={player.nickname}
        action={back}
      >
        <div className="row-gap">
          <Status tone={toneOf("player", player.status)}>
            {label("userStatus", player.status)}
          </Status>
          {player.online ? (
            <Status tone="live">{t("online")}</Status>
          ) : (
            <Status tone="neutral">{t("offline")}</Status>
          )}
          {player.leaderboardHidden && (
            <Status tone="warn">{t("hidden")}</Status>
          )}
          {access.granted.has("users.read") && (
            <Link
              href={`/users/${player.userId}`}
              className="panel-link"
              style={{ margin: 0 }}
            >
              <UserCircleIcon aria-hidden="true" />
              {t("account")}
            </Link>
          )}
        </div>
        <div className="stats">
          <Stat
            label={t("rating")}
            value={f.number(player.rating)}
            size="lg"
            hint={player.ratedMatches < 30 ? t("provisional") : undefined}
          />
          <Stat
            label={t("matches")}
            value={f.number(player.matches)}
            hint={t("rated", { count: player.ratedMatches })}
          />
          <Stat
            label={t("record")}
            value={`${f.number(player.wins)}–${f.number(player.losses)}`}
          />
          <Stat
            label={t("winRate")}
            value={stats?.winRate != null ? f.percent(stats.winRate) : "—"}
          />
          <Stat
            label={t("accuracy")}
            value={stats?.accuracy != null ? f.percent(stats.accuracy) : "—"}
          />
          <Stat
            label={t("streak")}
            value={f.number(stats?.currentStreak ?? player.currentStreak ?? 0)}
            hint={t("longest", {
              count: stats?.longestStreak ?? player.longestStreak ?? 0,
            })}
          />
        </div>
        {moderate && (
          <div className="row-gap">
            <ActionDialog
              action={resetNickname}
              triggerLabel={t("resetNickname")}
              triggerIcon={<PencilSimpleSlashIcon aria-hidden="true" />}
              title={t("resetTitle")}
              description={t("resetDescription", { nickname: player.nickname })}
              consequences={[t("resetEffect"), t("resetLive"), t("audited")]}
              confirmLabel={t("resetConfirm")}
              destructive
              hidden={{ userId: player.userId }}
            />
            {player.leaderboardHidden ? (
              <ActionDialog
                action={setLeaderboardVisibility}
                triggerLabel={t("show")}
                triggerIcon={<EyeIcon aria-hidden="true" />}
                title={t("showTitle")}
                description={t("showDescription", {
                  nickname: player.nickname,
                })}
                consequences={[t("showEffect"), t("audited")]}
                confirmLabel={t("showConfirm")}
                hidden={{ userId: player.userId, hidden: "false" }}
              />
            ) : (
              <ActionDialog
                action={setLeaderboardVisibility}
                triggerLabel={t("hide")}
                triggerIcon={<EyeSlashIcon aria-hidden="true" />}
                title={t("hideTitle")}
                description={t("hideDescription", {
                  nickname: player.nickname,
                })}
                consequences={[t("hideEffect"), t("hideKeeps"), t("audited")]}
                confirmLabel={t("hideConfirm")}
                destructive
                hidden={{ userId: player.userId, hidden: "true" }}
              />
            )}
          </div>
        )}
      </Panel>

      <div className="grid-main">
        <Panel id="rating" title={t("ratingHistory")} note={t("ratingNote")}>
          {history.length === 0 ? (
            <EmptyState size="sm" title={t("noRated")} />
          ) : (
            <>
              <LineChart
                label={t("ratingHistory")}
                points={history.map((entry, index) => ({
                  key: `${entry.matchId}-${index}`,
                  label: f.dateTime(entry.at),
                  value: entry.after,
                }))}
                start={f.date(history[0]?.at ?? "")}
                end={f.date(history.at(-1)?.at ?? "")}
              />
              <DataTable label={t("recentChanges")} stack={false} compact>
                <thead>
                  <tr>
                    <th scope="col">{t("colMatch")}</th>
                    <th scope="col" className="num">
                      {t("colChange")}
                    </th>
                    <th scope="col" className="num">
                      {t("colAfter")}
                    </th>
                    <th scope="col">{t("colAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ratingHistory.slice(0, 6).map((entry) => (
                    <tr key={`${entry.matchId}-${entry.at}`}>
                      <td>
                        <Link
                          href={`/battleship/matches/${entry.matchId}`}
                          className="link mono"
                        >
                          {entry.matchId.slice(0, 8)}
                        </Link>
                      </td>
                      <td
                        className="num"
                        style={{
                          color:
                            entry.delta >= 0
                              ? "var(--success)"
                              : "var(--destructive)",
                        }}
                      >
                        {entry.delta >= 0 ? `+${entry.delta}` : entry.delta}
                      </td>
                      <td className="num">{entry.after}</td>
                      <td>
                        <Time iso={entry.at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </>
          )}
        </Panel>
        <div className="stack">
          <Panel id="bots" title={t("botWins")}>
            <Bars
              label={t("botWins")}
              items={botLevels.map((level) => ({
                key: level,
                label: label("botLevel", level),
                value: stats?.botWins[level] ?? 0,
                display: f.number(stats?.botWins[level] ?? 0),
                tone: "muted",
              }))}
            />
            {stats?.averageMovesToWin != null && (
              <p className="small muted">
                {t("averageMoves", {
                  moves: Math.round(stats.averageMovesToWin),
                })}
              </p>
            )}
          </Panel>
          <Panel id="grants" title={t("grants")}>
            {grants.length === 0 ? (
              <p className="small muted">{t("noGrants")}</p>
            ) : (
              <ul className="stack-sm">
                {grants.map((grant) => (
                  <li
                    key={grant.grantId}
                    className="row-gap"
                    style={{ justifyContent: "space-between" }}
                  >
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <span className="mono small">{grant.feature}</span>
                      <span className="small muted">
                        {label("grantSource", grant.sourceType)} ·{" "}
                        {grant.validUntil ? (
                          <Time iso={grant.validUntil} format="date" />
                        ) : (
                          t("forever")
                        )}
                      </span>
                    </span>
                    <Status tone={grant.active ? "ok" : "neutral"}>
                      {grant.active
                        ? t("active")
                        : label("grantState", grant.state)}
                    </Status>
                  </li>
                ))}
              </ul>
            )}
            {player.cosmetics && (
              <Facts
                items={Object.entries(player.cosmetics).map(([slot, item]) => ({
                  key: slot,
                  label: label("cosmeticSlot", slot),
                  value: <span className="mono small">{item}</span>,
                }))}
              />
            )}
          </Panel>
        </div>
      </div>

      <Suspense
        fallback={
          <TableSkeleton
            label={t("matchesTitle")}
            rows={4}
            withFilters={false}
          />
        }
      >
        <MatchesTable
          filter={{ userId: player.userId }}
          title={t("matchesTitle")}
          pager={false}
          limit={10}
        />
      </Suspense>
    </>
  );
}
