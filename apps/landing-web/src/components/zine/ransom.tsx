import { generator, pick, seed, tilt } from "./random";

const FACES = [
  "mast",
  "loud",
  "tabloid",
  "sign",
  "kitsch",
  "stamp",
  "pixel",
  "body",
] as const;
const PAPERS = ["white", "yellow", "ink", "red", "blue", "news", "pink"];

/**
 * A ransom-note line: every letter cut out of a different magazine. Screen
 * readers get the plain text; the clippings are decoration. Each letter
 * twitches now and then on its own (a long CSS cycle with a seeded delay)
 * and shuffles on hover.
 */
export function Ransom({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const next = generator(seed(text));
  const words = text.split(" ");
  return (
    <span className={`ransom ${className ?? ""}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, w) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: words can repeat; the position is the identity.
          <span key={`${word}-${w}`} className="ransom-word">
            {[...word].map((letter, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the position is the identity.
                key={i}
                className={`ransom-letter rf-${pick(next, FACES)} rp-${pick(next, PAPERS)}`}
                style={
                  {
                    "--r": `${tilt(next, 7)}deg`,
                    "--dy": `${tilt(next, 5)}px`,
                    "--s": (0.86 + next() * 0.3).toFixed(2),
                    "--d": `${(next() * 14).toFixed(1)}s`,
                  } as React.CSSProperties
                }
              >
                {letter}
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}
