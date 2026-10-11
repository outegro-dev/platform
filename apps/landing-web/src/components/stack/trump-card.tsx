"use client";

import { useState } from "react";
import type { TrumpTone } from "@/lib/stack";

type Stat = { key: string; label: string; value: number };

/**
 * A trading card that flips over on its button. Both sides stay in the
 * markup for screen readers and without scripts; turning it is only visual
 * (and instant under reduced motion, see stack.css). The button stretches
 * over the whole card, so a tap anywhere flips it.
 */
export function TrumpCard({
  number,
  name,
  role,
  tone,
  stats,
  factLabel,
  fact,
  weakLabel,
  weak,
  flip,
}: {
  number: string;
  name: string;
  role: string;
  tone: TrumpTone;
  stats: Stat[];
  factLabel: string;
  fact: string;
  weakLabel: string;
  weak: string;
  flip: string;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <article
      className="trump"
      data-band={tone}
      data-flipped={flipped || undefined}
    >
      <div className="trump-inner">
        <div className="trump-face trump-front">
          <header className="trump-band">
            <p className="trump-number">{number}</p>
            <h3 className="trump-name">{name}</h3>
            <p className="trump-role">{role}</p>
          </header>
          <dl className="trump-stats">
            {stats.map((stat) => (
              <div key={stat.key}>
                <dt>{stat.label}</dt>
                <dd>
                  <span
                    className="trump-bar"
                    style={{ "--v": `${stat.value}%` } as React.CSSProperties}
                    aria-hidden="true"
                  />
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="trump-face trump-back">
          <p className="trump-back-name" aria-hidden="true">
            {name}
          </p>
          <p className="trump-label">{factLabel}</p>
          <p className="trump-fact">{fact}</p>
          <p className="trump-label">{weakLabel}</p>
          <p className="trump-weak">{weak}</p>
        </div>
      </div>
      <button
        type="button"
        className="trump-flip"
        aria-pressed={flipped}
        onClick={() => setFlipped((side) => !side)}
      >
        <span aria-hidden="true">↻</span> {flip}
        <span className="sr-only">: {name}</span>
      </button>
    </article>
  );
}
