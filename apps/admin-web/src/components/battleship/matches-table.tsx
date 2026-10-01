import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataTable, Pager, Time } from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import type { MatchFilter } from "@/lib/adapters/battleship";
import { getLabels } from "@/lib/labels";
import { finishReasonOf } from "@/lib/match";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";
import { ParticipantLink, participantName } from "./participant";

export async function MatchesTable({
  filter,
  title,
  pager = true,
  limit = 25,
}: {
  filter: MatchFilter;
  title: string;
  pager?: boolean;
  limit?: number;
}) {
  const t = await getTranslations("battleship.matches");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().battleship.matches({ ...filter, limit }),
  );
  if (!result.ok) {
    return (
      <Panel
        title={title}
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
      <Panel title={title}>
        <EmptyState
          size="sm"
          search={Boolean(filter.status || filter.mode || filter.userId)}
          title={t("empty")}
          body={t("emptyBody")}
        />
      </Panel>
    );
  }
  const bot = t("bot");
  return (
    <Panel flush title={title}>
      <DataTable label={title}>
        <thead>
          <tr>
            <th scope="col">{t("colMatch")}</th>
            <th scope="col">{t("colStatus")}</th>
            <th scope="col">{t("colWinner")}</th>
            <th scope="col" className="num">
              {t("colMoves")}
            </th>
            <th scope="col">{t("colStarted")}</th>
            <th scope="col">{t("colDuration")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((match) => {
            const end = match.finishedAt ?? null;
            const start = match.battleStartedAt ?? match.createdAt;
            const finish = finishReasonOf(match);
            return (
              <tr key={match.id}>
                <td data-primary="">
                  <Link
                    href={`/battleship/matches/${match.id}`}
                    className="row-link cell-main"
                    prefetch={false}
                  >
                    {participantName(match.a, label, bot)} {t("versus")}{" "}
                    {participantName(match.b, label, bot)}
                  </Link>
                  <span className="cell-sub">
                    {label("matchMode", match.mode)}
                    {match.rated ? ` · ${t("rated")}` : ""}
                    {match.ratingDelta !== null
                      ? ` · ±${match.ratingDelta}`
                      : ""}
                  </span>
                </td>
                <td data-label={t("colStatus")}>
                  <Status tone={toneOf("match", match.status)}>
                    {label("matchStatus", match.status)}
                  </Status>
                </td>
                <td data-label={t("colWinner")}>
                  {match.winner ? (
                    <ParticipantLink
                      participant={match.winner === "a" ? match.a : match.b}
                      label={label}
                      bot={bot}
                    />
                  ) : (
                    <span className="muted">—</span>
                  )}
                  {finish && (
                    <span className="cell-sub">
                      {label("finishReason", finish)}
                    </span>
                  )}
                  {match.abortReason && (
                    <span className="cell-sub">
                      {label("abortReason", match.abortReason)}
                    </span>
                  )}
                </td>
                <td data-label={t("colMoves")} className="num">
                  {match.moves}
                </td>
                <td data-label={t("colStarted")}>
                  <Time iso={match.createdAt} />
                </td>
                <td data-label={t("colDuration")}>
                  {end ? (
                    f.duration(Date.parse(end) - Date.parse(start))
                  ) : (
                    <span className="muted">{t("ongoing")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {pager && (
        <Pager
          path="/battleship/matches"
          params={{
            status: filter.status,
            mode: filter.mode,
            userId: filter.userId,
            cursor: filter.cursor,
          }}
          nextCursor={nextCursor}
          shown={items.length}
        />
      )}
    </Panel>
  );
}
