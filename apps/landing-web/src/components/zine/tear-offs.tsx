"use client";

import { useState } from "react";
import { generator, seed } from "./random";

/** A torn paper edge: the bottom of a stub, jagged at seeded heights. */
function ragged(next: () => number) {
  const edge = ["0 0", "100% 0"];
  for (let x = 100; x >= 0; x -= 12.5)
    edge.push(`${x}% ${Math.round(35 + next() * 65)}%`);
  return `polygon(${edge.join(", ")})`;
}

/**
 * The fringe of tear-off tabs under a street ad. Someone has been here
 * already: 1–3 tabs per ad (seeded by its text, the same on every render)
 * are gone, leaving ragged stubs. The ad itself is the link, so the fringe
 * is paper for assistive tech; a click on a tab still opens Telegram and
 * tears the tab off on the way.
 */
export function TearOffs({
  href,
  handle,
  seedText,
  count = 6,
}: {
  href: string;
  handle: string;
  seedText: string;
  count?: number;
}) {
  const [torn, setTorn] = useState<number[]>([]);
  const next = generator(seed(seedText));
  const stubs = new Map<number, string>();
  const missing = 1 + Math.floor(next() * 3);
  while (stubs.size < missing) {
    const i = Math.floor(next() * count);
    if (!stubs.has(i)) stubs.set(i, ragged(next));
  }

  return (
    <ul className="tear-offs" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const stub = stubs.get(i);
        return stub ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed strips; the position is the identity.
          <li key={i} className="is-stub">
            <span style={{ clipPath: stub }} />
          </li>
        ) : (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed strips; the position is the identity.
            key={i}
            data-torn={torn.includes(i) ? "" : undefined}
            style={
              {
                "--fall": `${(i % 2 ? 1 : -1) * (18 + i * 7)}deg`,
              } as React.CSSProperties
            }
          >
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={-1}
              onClick={() => setTorn((list) => [...list, i])}
            >
              {handle}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
