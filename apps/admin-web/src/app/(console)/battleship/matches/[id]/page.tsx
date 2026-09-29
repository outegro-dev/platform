import { ArrowLeftIcon, StopCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { abortMatch } from "@/app/(console)/battleship/actions";
import {
  ParticipantLink,
  participantName,
} from "@/components/battleship/participant";
import { Replay } from "@/components/battleship/replay";
import { ActionDialog } from "@/components/ui/action-dialog";
import { CopyText } from "@/components/ui/copy-text";
import { Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import type { Params } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("battleship.match");
  return { title: t("title") };
}

/** One match: both fleets, every shot, and a way to stop it if it is live. */
export default async function MatchPage({ params }: { params: Params<"id"> }) {
  const access = await pageAccess("battleship.read");
  if (!access.ok) return access.element;
  const { id } = await params;
  const t = await getTranslations("battleship.match");
  const label = await getLabels();
  const f = await getFormatter();
  const back = (
    <Link
      href="/battleship/matches"
      className="panel-link"
      style={{ margin: 0 }}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {t("back")}
    </Link>
  );
  const result = await load(() => services().battleship.match(id));
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
  const match = result.data;
  const bot = t("bot");
  const names = {
    a: participantName(match.a, label, bot),
    b: participantName(match.b, label, bot),
  };
  const live = match.status === "placement" || match.status === "battle";
  const start = match.battleStartedAt ?? match.createdAt;

  return (
    <>
      <Panel
        id="match"
        kicker={`${label("matchMode", match.mode)}${match.rated ? ` · ${t("rated")}` : ""}`}
        title={`${names.a} ${t("versus")} ${names.b}`}
        action={back}
      >
        <div className="row-gap">
          <Status tone={toneOf("match", match.status)}>
            {label("matchStatus", match.status)}
          </Status>
          {match.winner && (
            <span className="small">
              {t("winner")} <strong>{names[match.winner]}</strong>
              {match.reason && <> · {label("finishReason", match.reason)}</>}
            </span>
          )}
          {match.abortReason && (
            <span className="small">
              {label("abortReason", match.abortReason)}
            </span>
          )}
        </div>
        <Facts
          items={[
            {
              label: t("id"),
              value: <CopyText value={match.id} display={shortId(match.id)} />,
            },
            {
              label: t("playerA"),
              value: (
                <ParticipantLink
                  participant={match.a}
                  label={label}
                  bot={bot}
                />
              ),
            },
            {
              label: t("playerB"),
              value: (
                <ParticipantLink
                  participant={match.b}
                  label={label}
                  bot={bot}
                />
              ),
            },
            { label: t("firstTurn"), value: names[match.firstTurn] },
            {
              label: t("moves"),
              value: <span className="num">{match.moves}</span>,
            },
            {
              label: t("rating"),
              value:
                match.ratingDelta !== null ? (
                  <span className="num">±{match.ratingDelta}</span>
                ) : (
                  <span className="muted">{t("unrated")}</span>
                ),
            },
            { label: t("created"), value: <Time iso={match.createdAt} /> },
            {
              label: t("duration"),
              value: match.finishedAt
                ? f.duration(Date.parse(match.finishedAt) - Date.parse(start))
                : t("ongoing"),
            },
          ]}
        />
        {match.live && (
          <p className="notice">
            <span>
              {t("liveState", {
                phase: label("matchStatus", match.live.phase),
                turn: match.live.turn ? names[match.live.turn] : "—",
              })}
              {match.live.deadline && (
                <>
                  {" · "}
                  {t("deadline")} <Time iso={match.live.deadline} />
                </>
              )}
              {(["a", "b"] as const)
                .filter((side) => match.live?.connected[side] === false)
                .map(
                  (side) => ` · ${t("disconnected", { player: names[side] })}`,
                )
                .join("")}
            </span>
          </p>
        )}
        {live && access.granted.has("battleship.moderate") && (
          <div className="row-gap">
            <ActionDialog
              action={abortMatch}
              triggerLabel={t("abort")}
              triggerVariant="destructive"
              triggerIcon={<StopCircleIcon aria-hidden="true" />}
              title={t("abortTitle")}
              description={t("abortDescription", { a: names.a, b: names.b })}
              consequences={[
                t("abortEffect"),
                t("abortRating"),
                t("abortPlayers"),
                t("audited"),
              ]}
              confirmLabel={t("abortConfirm")}
              destructive
              hidden={{ matchId: match.id }}
            />
          </div>
        )}
      </Panel>
      <Panel id="boards" title={t("boards")} note={t("boardsNote")}>
        <Replay fleets={match.fleets} moves={match.history} names={names} />
      </Panel>
    </>
  );
}
