import type { Board } from "@outegro/contracts/atelier";
import { getTranslations } from "next-intl/server";
import { replyRate } from "@/lib/board";
import { getFormatter } from "@/lib/request";

/** The owner's numbers in one line of figures (a tape measure, not cards). */
export async function StatsStrip({ stats }: { stats: Board["stats"] }) {
  const t = await getTranslations("board.stats");
  const format = await getFormatter();
  const rate = replyRate(stats);
  const items = [
    { key: "total", value: stats.total, note: null },
    { key: "sent", value: stats.sent, note: null },
    { key: "sentToday", value: stats.sentToday, note: null },
    {
      key: "replies",
      value: stats.replies,
      note:
        rate === null ? null : t("replyRate", { rate: format.percent(rate) }),
    },
    { key: "interviews", value: stats.interviews, note: null },
    { key: "offers", value: stats.offers, note: null },
  ] as const;
  return (
    <section className="stats" aria-label={t("label")}>
      <dl className="stats-list">
        {items.map((item) => (
          <div key={item.key} className="stat" data-key={item.key}>
            <dt className="stat-label">{t(item.key)}</dt>
            <dd className="stat-value">{format.number(item.value)}</dd>
            {item.note ? <dd className="stat-note">{item.note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
