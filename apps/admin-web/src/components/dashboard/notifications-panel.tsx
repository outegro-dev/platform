import { getTranslations } from "next-intl/server";
import { DailyBars } from "@/components/ui/charts";
import { Panel, PanelLink, Stat, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import type { NotificationsOverview } from "@/lib/adapters/notifications";
import { dayLabel, lastDays } from "@/lib/format";
import { notificationsOverview } from "@/lib/queries";
import { getFormatter } from "@/lib/request";

const OK = ["accepted", "delivered"] as const;
const BAD = ["failed", "expired", "unknown"] as const;

export function deliveryTotals(overview: NotificationsOverview) {
  let ok = 0;
  let bad = 0;
  for (const states of Object.values(overview.last24h.deliveries)) {
    for (const state of OK) ok += states[state] ?? 0;
    for (const state of BAD) bad += states[state] ?? 0;
  }
  return { ok, bad };
}

export async function NotificationsPanel() {
  const t = await getTranslations("dashboard.notifications");
  const f = await getFormatter();
  const result = await notificationsOverview();
  const head = {
    id: "notifications",
    kicker: t("kicker"),
    title: t("title"),
    action: <PanelLink href="/notifications">{t("open")}</PanelLink>,
    className: "h-panel",
  };
  if (!result.ok) {
    return (
      <Panel {...head}>
        <FailureState failure={result} what={t("what")} />
      </Panel>
    );
  }
  const data = result.data;
  const totals = deliveryTotals(data);
  const byDay = new Map<string, { ok: number; bad: number }>();
  for (const row of data.daily) {
    const day = byDay.get(row.day) ?? { ok: 0, bad: 0 };
    day.ok += row.ok;
    day.bad += row.bad;
    byDay.set(row.day, day);
  }
  const days = lastDays(7, Date.parse(data.generatedAt)).map((day) => ({
    day,
    label: dayLabel(day, f.locale),
    values: byDay.get(day) ?? { ok: 0, bad: 0 },
  }));
  const { email, telegram } = data.channels;
  return (
    <Panel
      {...head}
      note={t("generated", { time: f.dateTime(data.generatedAt) })}
    >
      <div className="stats">
        <Stat label={t("delivered")} value={f.number(totals.ok)} size="lg" />
        <Stat
          label={t("failed")}
          value={f.number(totals.bad)}
          tone={totals.bad > 0 ? "bad" : undefined}
        />
        <Stat
          label={t("backlog")}
          value={f.number(data.backlog.count)}
          tone={data.backlog.count > 0 ? "warn" : undefined}
          hint={
            data.backlog.oldestCreatedAt
              ? t("oldest", { time: f.relative(data.backlog.oldestCreatedAt) })
              : t("noBacklog")
          }
        />
        <Stat
          label={t("recipients")}
          value={f.number(data.recipients.total)}
          hint={t("telegramLinked", { count: data.recipients.telegramLinked })}
        />
      </div>
      <DailyBars
        label={t("chart")}
        days={days}
        series={[
          { key: "ok", label: t("okSeries") },
          { key: "bad", label: t("badSeries"), tone: "bad" },
        ]}
        formatValue={(value) => f.number(Math.round(value))}
        height={120}
      />
      <div className="row-gap">
        <span className="small muted">{t("channels")}</span>
        <Status tone={email.enabled ? "ok" : "warn"}>
          {t("email")}: {email.enabled ? t("on") : t("paused")}
        </Status>
        <Status
          tone={
            !telegram.configured ? "neutral" : telegram.enabled ? "ok" : "warn"
          }
        >
          {t("telegram")}:{" "}
          {!telegram.configured
            ? t("notConfigured")
            : telegram.enabled
              ? t("on")
              : t("paused")}
        </Status>
      </div>
    </Panel>
  );
}
