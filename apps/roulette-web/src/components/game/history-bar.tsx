import type { HistoryItem } from "@outegro/contracts/roulette";
import { useTranslations } from "next-intl";

/** The ten latest numbers as dots, and the colour counts over what we have. */
export function HistoryBar({ history }: { history: HistoryItem[] }) {
  const t = useTranslations("history");
  if (history.length === 0)
    return (
      <div className="rl-histbar">
        <p className="rl-last">{t("empty")}</p>
      </div>
    );
  const counts = { red: 0, green: 0, black: 0 };
  for (const item of history) counts[item.color] += 1;
  return (
    <div className="rl-histbar">
      <ol className="rl-hist" aria-label={t("label")}>
        {history.slice(0, 10).map((item) => (
          <li
            key={item.round}
            className={`rl-dot rl-${item.color}`}
            title={`№ ${item.round}`}
          >
            {item.number}
          </li>
        ))}
      </ol>
      <p className="rl-last">
        {t("counts", { count: history.length })}
        <span>
          <i className="rl-mini rl-red" aria-hidden="true" />
          <span className="sr-only">{t("red", { count: counts.red })}</span>
          <span aria-hidden="true">{counts.red}</span>
        </span>
        <span>
          <i className="rl-mini rl-green" aria-hidden="true" />
          <span className="sr-only">{t("green", { count: counts.green })}</span>
          <span aria-hidden="true">{counts.green}</span>
        </span>
        <span>
          <i className="rl-mini rl-black" aria-hidden="true" />
          <span className="sr-only">{t("black", { count: counts.black })}</span>
          <span aria-hidden="true">{counts.black}</span>
        </span>
      </p>
    </div>
  );
}
