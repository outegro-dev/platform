"use client";

import { useState } from "react";

/**
 * The fringe of tear-off phone numbers under a street ad. Each strip is a
 * real link to Telegram; clicking it also tears it off and lets it fall.
 */
export function TearOffs({
  href,
  handle,
  count = 6,
  label,
}: {
  href: string;
  handle: string;
  count?: number;
  label: string;
}) {
  const [torn, setTorn] = useState<number[]>([]);
  return (
    <ul className="tear-offs">
      {Array.from({ length: count }, (_, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: identical strips; the position is the identity.
          key={i}
          data-torn={torn.includes(i) ? "" : undefined}
          // one strip is enough for keyboards and screen readers; the rest are paper
          aria-hidden={i > 0 || undefined}
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
            aria-label={`${label}: ${handle}`}
            tabIndex={i > 0 ? -1 : undefined}
            onClick={() => setTorn((list) => [...list, i])}
          >
            {handle}
          </a>
        </li>
      ))}
    </ul>
  );
}
