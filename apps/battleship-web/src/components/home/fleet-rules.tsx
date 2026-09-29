import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { ShipArt } from "../board/ship";

const classes = [
  { length: 4, count: 1 },
  { length: 3, count: 2 },
  { length: 2, count: 3 },
  { length: 1, count: 4 },
] as const;

/** The classic fleet at a glance, drawn with the same ships as the board. */
export async function FleetRules() {
  const t = await getTranslations("home");
  return (
    <section className="card" aria-labelledby="rules-title">
      <div className="section-head">
        <h2 id="rules-title">{t("rulesTitle")}</h2>
      </div>
      <p>{t("rulesLead")}</p>
      <ul className="fleet-legend">
        {classes.map(({ length, count }) => (
          <li key={length}>
            <span className="legend-ships" aria-hidden="true">
              {Array.from({ length: Math.min(count, 4) }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: identical ships
                  key={i}
                  className="legend-ship"
                  style={{ "--len": length } as CSSProperties}
                >
                  <ShipArt length={length} skin="classic" />
                </span>
              ))}
            </span>
            <span>{t(`ships.${length}`)}</span>
          </li>
        ))}
      </ul>
      <p className="small muted">{t("rulesTurn")}</p>
    </section>
  );
}
