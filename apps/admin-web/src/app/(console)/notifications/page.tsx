import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { deliveryTotals } from "@/components/dashboard/notifications-panel";
import { DailyBars } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/data";
import { Panel, PanelLink, Stat, Status } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { deliveryStates, externalChannels } from "@/lib/adapters/notifications";
import { dayLabel, lastDays } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { notificationsOverview } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

async function Overview() {
  const t = await getTranslations("notifications.overview");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await notificationsOverview();
  if (!result.ok) {
    return (
      <Panel>
        <FailureState failure={result} what={t("what")} />
      </Panel>
    );
  }
  const data = result.data;
  const totals = deliveryTotals(data);
  const series = new Map<string, Record<string, number>>();
  for (const row of data.daily) {
    const day = series.get(row.day) ?? {};
    day[`${row.channel}-ok`] = (day[`${row.channel}-ok`] ?? 0) + row.ok;
    day.bad = (day.bad ?? 0) + row.bad;
    series.set(row.day, day);
  }
  const days = lastDays(7, Date.parse(data.generatedAt)).map((day) => ({
    day,
    label: dayLabel(day, f.locale),
    values: series.get(day) ?? {},
  }));
  const shownStates = deliveryStates.filter((state) =>
    externalChannels.some(
      (channel) => (data.last24h.deliveries[channel]?.[state] ?? 0) > 0,
    ),
  );

  return (
    <>
      <Panel
        id="last-day"
        kicker={t("kicker")}
        title={t("title")}
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
                ? t("oldest", {
                    time: f.relative(data.backlog.oldestCreatedAt),
                  })
                : t("noBacklog")
            }
          />
          <Stat label={t("intents")} value={f.number(data.last24h.intents)} />
        </div>
      </Panel>
      <div className="grid-main">
        <Panel id="week" title={t("week")} note={t("weekNote")}>
          <DailyBars
            label={t("week")}
            days={days}
            series={[
              { key: "email-ok", label: t("emailOk") },
              { key: "telegram-ok", label: t("telegramOk"), tone: "muted" },
              { key: "bad", label: t("bad"), tone: "bad" },
            ]}
            formatValue={(value) => f.number(Math.round(value))}
            height={170}
          />
        </Panel>
        <Panel id="recipients" title={t("recipients")}>
          <div className="stats">
            <Stat
              label={t("recipientsTotal")}
              value={f.number(data.recipients.total)}
            />
            <Stat
              label={t("emailVerified")}
              value={f.number(data.recipients.emailVerified)}
            />
            <Stat
              label={t("telegramLinked")}
              value={f.number(data.recipients.telegramLinked)}
            />
          </div>
          <div className="stack-sm">
            <div className="row-gap">
              <span className="small muted">{t("email")}</span>
              <Status tone={data.channels.email.enabled ? "ok" : "warn"}>
                {data.channels.email.enabled ? t("on") : t("paused")}
              </Status>
              <span className="small mono muted">
                {data.channels.email.provider}
              </span>
            </div>
            <div className="row-gap">
              <span className="small muted">{t("telegram")}</span>
              <Status
                tone={
                  !data.channels.telegram.configured
                    ? "neutral"
                    : data.channels.telegram.enabled
                      ? "ok"
                      : "warn"
                }
              >
                {!data.channels.telegram.configured
                  ? t("notConfigured")
                  : data.channels.telegram.enabled
                    ? t("on")
                    : t("paused")}
              </Status>
              {data.channels.telegram.botUsername && (
                <span className="small mono muted">
                  @{data.channels.telegram.botUsername}
                </span>
              )}
            </div>
          </div>
          <PanelLink href="/notifications/channels">
            {t("manageChannels")}
          </PanelLink>
        </Panel>
      </div>
      <Panel flush id="by-state" title={t("byState")} note={t("byStateNote")}>
        <DataTable label={t("byState")} stack={false}>
          <thead>
            <tr>
              <th scope="col">{t("channel")}</th>
              {shownStates.map((state) => (
                <th key={state} scope="col" className="num">
                  {label("delivery", state)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {externalChannels.map((channel) => (
              <tr key={channel}>
                <th
                  scope="row"
                  style={{
                    textAlign: "start",
                    paddingInlineStart: "var(--panel-pad)",
                  }}
                >
                  {label("channel", channel)}
                </th>
                {shownStates.map((state) => {
                  const value = data.last24h.deliveries[channel]?.[state] ?? 0;
                  return (
                    <td key={state} className="num">
                      {value > 0 ? (
                        <Link
                          className="link"
                          href={`/notifications/deliveries?channel=${channel}&state=${state}`}
                        >
                          <Status tone={toneOf("delivery", state)}>
                            {f.number(value)}
                          </Status>
                        </Link>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </DataTable>
        {shownStates.length === 0 && (
          <p className="pager">{t("noDeliveries")}</p>
        )}
      </Panel>
    </>
  );
}

export default async function NotificationsOverviewPage() {
  const access = await pageAccess("notifications.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("notifications.overview");
  return (
    <Suspense
      fallback={
        <PanelSkeleton className="h-panel" label={t("title")} chart rows={3} />
      }
    >
      <Overview />
    </Suspense>
  );
}
