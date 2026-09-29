import { RobotIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { Participant } from "@/lib/adapters/battleship";
import { shortId } from "@/lib/format";
import type { Label } from "@/lib/labels";

/** Display name of a side: nickname, a short id, or the bot and its level. */
export function participantName(
  participant: Participant,
  label: Label,
  bot: string,
): string {
  if (participant.kind === "bot")
    return participant.level
      ? `${bot} · ${label("botLevel", participant.level)}`
      : bot;
  return participant.nickname ?? shortId(participant.userId);
}

export function ParticipantLink({
  participant,
  label,
  bot,
}: {
  participant: Participant;
  label: Label;
  bot: string;
}) {
  if (participant.kind === "bot") {
    return (
      <span className="row-gap" style={{ gap: 6 }}>
        <RobotIcon aria-hidden="true" size={16} />
        {participantName(participant, label, bot)}
      </span>
    );
  }
  return (
    <Link
      href={`/battleship/players/${participant.userId}`}
      className="link above"
      prefetch={false}
    >
      {participantName(participant, label, bot)}
    </Link>
  );
}
