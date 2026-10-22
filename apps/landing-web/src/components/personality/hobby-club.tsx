import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/section-heading";
import { Stamp } from "@/components/zine/stamp";
import "./personality.css";

/** A step of a diagram, or steps side by side (two builds of one spec). */
type Part = string | string[];
type Card = {
  id: "bike" | "extension" | "watchdog";
  title: string;
  figure: string;
  alt: string;
  /** Set while the thing is still being built: a stamp says so. */
  status?: string;
  body: string;
  parts: Part[];
  notes: string[];
};

/** Lines through a hub from `inner` to `outer`, every 30 degrees. */
function spokes(x: number, y: number, inner: number, outer: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const at = (r: number) =>
      `${(x + dx * r).toFixed(1)} ${(y + dy * r).toFixed(1)}`;
    return `M${at(outer)}L${at(inner)}M${at(-inner)}L${at(-outer)}`;
  }).join("");
}

/**
 * The drawings in blue ink, as in a hobby magazine: a general view only,
 * nothing on them that the text does not say. Centre lines dash-dotted.
 */
const drawings: Record<Card["id"], React.ReactNode> = {
  bike: (
    <>
      <circle cx="58" cy="104" r="38" />
      <circle cx="58" cy="104" r="33" />
      <circle cx="184" cy="104" r="38" />
      <circle cx="184" cy="104" r="33" />
      <path
        className="is-thin"
        d={spokes(58, 104, 4, 33) + spokes(184, 104, 4, 33)}
      />
      <circle cx="58" cy="104" r="4" />
      <circle cx="184" cy="104" r="4" />
      <circle cx="58" cy="104" r="7" className="is-thin" />
      {/* the frame: chain and seat stays, seat, top and down tubes, fork */}
      <path d="M58 104L112 108L100 50L58 104M101 54L168 50M112 108L164 62M168 44L163 64Q171 92 184 104" />
      <path d="M100 50L97 38M84 36Q97 31 112 35L108 39Q96 37 86 39Z" />
      <path d="M168 44L171 35M163 34L180 36Q190 38 188 48" />
      <circle cx="112" cy="108" r="9" />
      <path d="M112 108L123 121M118 123L129 120" />
      <path className="is-thin" d="M112 99L58 97M112 117L58 111" />
      <path
        className="is-axis"
        d="M42 104H74M58 88V120M168 104H200M184 88V120"
      />
      {/* overall length, left unmeasured */}
      <path
        className="is-thin"
        d="M58 140V150M184 140V150M58 146H184M58 146l7-3M58 146l7 3M184 146l-7-3M184 146l-7 3"
      />
    </>
  ),
  extension: (
    <>
      {/* the browser: its toolbar, the address bar, the extension's icon */}
      <rect x="12" y="10" width="216" height="132" rx="6" />
      <path d="M12 32H228" />
      <circle cx="24" cy="21" r="3" className="is-thin" />
      <circle cx="34" cy="21" r="3" className="is-thin" />
      <circle cx="44" cy="21" r="3" className="is-thin" />
      <rect x="58" y="15" width="128" height="12" rx="6" className="is-thin" />
      <path d="M197 15h5a3 3 0 0 1 6 0h5v5a3 3 0 0 1 0 6v5h-16z" />
      {/* the items on the trading page, each with its price tag in two
          halves, one price from each site */}
      {[26, 96, 166].map((x) => (
        <g key={x}>
          <rect x={x} y="42" width="48" height="56" rx="3" />
          <path
            className="is-thin"
            d={`M${x + 9} 80L${x + 32} 57l7-3-3 7-23 23zM${x + 8} 92H${x + 40}`}
          />
          <rect x={x} y="106" width="48" height="22" rx="2" />
          <path className="is-thin" d={`M${x + 24} 106V128`} />
        </g>
      ))}
      <path className="is-axis" d="M205 33Q226 70 214 106" />
    </>
  ),
  watchdog: (
    <>
      <path d="M8 134H232" />
      {/* the kennel: walls, the roof over them, the door, the planks */}
      <path d="M64 134V76L120 36L176 76V134M52 80L120 30L188 80M56 86L120 40L184 86" />
      <path d="M98 134V102A22 22 0 0 1 142 102V134" />
      <path
        className="is-thin"
        d="M64 96H98M142 96H176M64 116H98M142 116H176"
      />
      <rect x="107" y="64" width="26" height="12" rx="1" />
      {/* a bowl on the left, a bone on the right */}
      <path d="M18 124H50L46 134H22Z" />
      <path d="M192 126H210M192 130H210" />
      <circle cx="190" cy="125" r="3" />
      <circle cx="190" cy="131" r="3" />
      <circle cx="212" cy="125" r="3" />
      <circle cx="212" cy="131" r="3" />
      <path className="is-axis" d="M120 16V140" />
    </>
  ),
};

/**
 * The hobby club: what I made outside the day job, drawn in blue ink on
 * graph paper, a sheet each, as in an old "do it yourself" magazine. The
 * bike built from parts, the browser extension that put two sites' skin
 * prices on the trading pages (2016-2020), the watchdog rewritten twice.
 * Each drawing has its text; how the parts fit is a list, so it reads
 * without the drawing. A sheet can carry a stamp (`status`) for a thing
 * still being built.
 */
export async function HobbyClub() {
  const t = await getTranslations("club");
  const cards = t.raw("cards") as Card[];
  return (
    <section
      id="club"
      className="club og-container section-space"
      aria-labelledby="club-title"
    >
      <SectionHeading
        id="club-title"
        index={t("index")}
        label={t("label")}
        title={t("title")}
        accent={t("titleAccent")}
      />
      <p className="section-lead">{t("intro")}</p>
      <ol className="club-sheets">
        {cards.map((card, i) => (
          <li key={card.id} data-reveal>
            <article className="club-sheet" aria-labelledby={`club-${card.id}`}>
              <header className="club-sheet-head">
                <h3 id={`club-${card.id}`}>{card.title}</h3>
                <p className="club-sheet-no">{t("sheet", { n: i + 1 })}</p>
              </header>
              <figure className="club-figure">
                <svg viewBox="0 0 240 152" role="img" aria-label={card.alt}>
                  {drawings[card.id]}
                </svg>
                <figcaption>{card.figure}</figcaption>
                {card.status && (
                  <Stamp text={card.status} className="club-status" />
                )}
              </figure>
              <p className="club-body">{card.body}</p>
              {card.parts.length > 0 && (
                <div className="club-diagram">
                  <p className="club-diagram-title">{t("diagram")}</p>
                  <ol className="club-flow">
                    {card.parts.map((part, step) => (
                      <li key={String(part)}>
                        {/* the list's order, drawn: nothing to read out */}
                        {step > 0 && (
                          <span className="club-arrow" aria-hidden="true">
                            →
                          </span>
                        )}
                        {Array.isArray(part) ? (
                          <ul className="club-fork">
                            {part.map((side) => (
                              <li key={side} className="club-part">
                                {side}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="club-part">{part}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {card.notes.length > 0 && (
                <ul className="club-notes">
                  {card.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
