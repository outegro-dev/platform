"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";

/**
 * The chapter's flash cards: a question that turns into its answer on a
 * click. The card is a toggle button named by its question — a name that
 * stays when the card turns; aria-expanded says whether the answer is
 * shown. The answer is a face of its own beside the button (readable as
 * text, not folded into the button's name), laid over it in one grid cell
 * so a card keeps its height when it turns; a click on it reaches the
 * button underneath. The hidden face is out of the accessibility tree.
 * Which cards are turned is trivial UI state and stays here.
 */
export function FlashCards({
  cards,
}: {
  cards: { id: string; front: ReactNode; back: ReactNode }[];
}) {
  const t = useTranslations("book.cards");
  const ids = useId();
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) => {
    const next = new Set(flipped);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFlipped(next);
  };

  return (
    <div className="flash-cards">
      <p className="flash-title">{t("title")}</p>
      <ul className="flash-grid">
        {cards.map((card, index) => {
          const open = flipped.has(card.id);
          const question = `${ids}-${index}-q`;
          const answer = `${ids}-${index}-a`;
          return (
            <li
              key={card.id}
              className="flash-item"
              data-open={open || undefined}
            >
              <button
                type="button"
                className="flash-card"
                aria-expanded={open}
                aria-controls={answer}
                aria-labelledby={question}
                onClick={() => toggle(card.id)}
              >
                <span className="flash-face flash-front">
                  <span className="flash-kicker">{t("question")}</span>
                  <span className="flash-text" id={question}>
                    {card.front}
                  </span>
                </span>
              </button>
              <div className="flash-face flash-back" id={answer}>
                <span className="flash-kicker">{t("answer")}</span>
                <span className="flash-text">{card.back}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
