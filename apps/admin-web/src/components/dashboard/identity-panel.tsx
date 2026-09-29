import { getTranslations } from "next-intl/server";
import { DailyBars } from "@/components/ui/charts";
import { Bars, Panel, PanelLink, Stat } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { dayLabel, lastDays } from "@/lib/format";
import { identityOverview } from "@/lib/queries";
import { getFormatter } from "@/lib/request";

export async function IdentityPanel() {
  const t = await getTranslations("dashboard.identity");
  const f = await getFormatter();
  const result = await identityOverview();
  const head = {
    id: "identity",
    kicker: t("kicker"),
    title: t("title"),
    action: <PanelLink href="/users">{t("open")}</PanelLink>,
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
  const signups = new Map(data.dailySignups.map((row) => [row.day, row.n]));
  const days = lastDays(7, Date.parse(data.generatedAt)).map((day) => ({
    day,
    label: dayLabel(day, f.locale),
    values: { signups: signups.get(day) ?? 0 },
  }));
  const methods = Object.entries(data.signIns7d).sort((a, b) => b[1] - a[1]);
  const roles = Object.entries(data.roleBindings).sort((a, b) => b[1] - a[1]);
  return (
    <Panel
      {...head}
      note={t("generated", { time: f.dateTime(data.generatedAt) })}
    >
      <div className="stats">
        <Stat label={t("users")} value={f.number(data.users.total)} size="lg" />
        <Stat
          label={t("new7d")}
          value={f.number(data.users.new7d)}
          hint={t("new24h", { count: data.users.new24h })}
        />
        <Stat
          label={t("sessions")}
          value={f.number(data.sessions.active)}
          hint={t("seen24h", { count: data.sessions.seen24h })}
        />
        <Stat
          label={t("suspended")}
          value={f.number(data.users.suspended)}
          tone={data.users.suspended > 0 ? "warn" : undefined}
        />
      </div>
      <DailyBars
        label={t("signupsChart")}
        days={days}
        series={[{ key: "signups", label: t("signups") }]}
        formatValue={(value) => f.number(Math.round(value))}
        height={120}
      />
      <div className="grid-2">
        <div className="stack-sm">
          <p className="panel-kicker">{t("methods")}</p>
          {methods.length ? (
            <Bars
              label={t("methods")}
              items={methods.map(([method, count]) => ({
                key: method,
                label: t.has(`method.${method}`)
                  ? t(`method.${method}`)
                  : method,
                value: count,
                display: f.number(count),
              }))}
            />
          ) : (
            <p className="small muted">{t("noSignIns")}</p>
          )}
        </div>
        <div className="stack-sm">
          <p className="panel-kicker">{t("roles")}</p>
          {roles.length ? (
            <Bars
              label={t("roles")}
              items={roles.map(([role, count]) => ({
                key: role,
                label: t.has(`role.${role}`) ? t(`role.${role}`) : role,
                value: count,
                display: f.number(count),
                tone: "muted",
              }))}
            />
          ) : (
            <p className="small muted">{t("noRoles")}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
