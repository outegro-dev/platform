"use client";

import type {
  ApplicationCard,
  ApplicationStage,
} from "@outegro/contracts/atelier";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { DragEvent } from "react";
import { applicationHref } from "@/lib/routes";
import { MoveMenu } from "./move-menu";
import {
  AgeLabel,
  ChannelLabel,
  FlagList,
  ScoreChip,
  useSourceLabel,
} from "./parts";

export const CARD_MIME = "application/x-atelier-card";

/**
 * One application on the board. The company is the link (its hit area
 * covers the card) and opens the side panel; the ⇄ button moves the card
 * from the keyboard; on a desktop the card can also be dragged.
 */
export function BoardCard({
  card,
  now,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onArchive,
}: {
  card: ApplicationCard;
  now: number;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (card: ApplicationCard) => void;
  onDragEnd: () => void;
  onMove: (card: ApplicationCard, stage: ApplicationStage) => void;
  onArchive: (card: ApplicationCard) => void;
}) {
  const t = useTranslations("board");
  const reasons = useTranslations("reasons");
  const sourceLabel = useSourceLabel();
  const titleId = `card-${card.id}`;
  return (
    <article
      className="app-card"
      aria-labelledby={titleId}
      data-dragging={dragging || undefined}
      data-attention={
        card.flags.includes("needs_human") || card.flags.includes("needs_edit")
          ? ""
          : undefined
      }
      draggable={draggable}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData(CARD_MIME, card.id);
        event.dataTransfer.setData("text/plain", card.company);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(card);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="app-card-head">
        <h3 className="app-card-company" id={titleId}>
          <Link
            href={applicationHref(card.id)}
            scroll={false}
            prefetch={false}
            className="app-card-link"
            draggable={false}
          >
            {card.company}
          </Link>
        </h3>
        <ScoreChip score={card.score} />
      </div>
      <p className="app-card-role">{card.role}</p>
      {card.stage === "archived" && card.archiveReason ? (
        <p className="app-card-reason">{reasons(card.archiveReason)}</p>
      ) : null}
      <FlagList flags={card.flags} label={t("flags")} />
      <div className="app-card-foot">
        <span className="app-card-meta">
          {card.channel ? (
            <ChannelLabel channel={card.channel} />
          ) : (
            <span className="channel">{sourceLabel(card.source)}</span>
          )}
          <AgeLabel iso={card.updatedAt} now={now} />
        </span>
        <MoveMenu
          company={card.company}
          stage={card.stage}
          onMove={(stage) => onMove(card, stage)}
          onArchive={() => onArchive(card)}
        />
      </div>
    </article>
  );
}
