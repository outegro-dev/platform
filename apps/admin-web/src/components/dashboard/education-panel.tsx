import { getTranslations } from "next-intl/server";
import { DailyBars } from "@/components/ui/charts";
import { Panel, PanelLink, Stat } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { dayLabel, lastDays } from "@/lib/format";
import { educationOverview } from "@/lib/queries";
import { getFormatter } from "@/lib/request";

/** On the dashboard it links to the section; on the section page it does not. */
export async function EducationPanel({ linked = true }: { linked?: boolean }) {
  const t = await getTranslations("dashboard.education");
  const f = await getFormatter();
  const result = await educationOverview();
  const head = {
    id: "education",
    kicker: t("kicker"),
    title: t("title"),
    action: linked ? (
      <PanelLink href="/education">{t("open")}</PanelLink>
    ) : undefined,
    className: linked ? "h-panel" : "h-panel-md",
    kind:
      !result.ok && result.kind === "not-connected"
        ? ("not-connected" as const)
        : undefined,
  };
  if (!result.ok) {
    return (
      <Panel {...head}>
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const data = result.data;
  // Fourteen UTC days ending today; a day the service left out had nobody.
  const active = new Map(data.activity.map((row) => [row.day, row.readers]));
  const days = lastDays(14, f.now).map((day) => ({
    day,
    label: dayLabel(day, f.locale),
    values: { readers: active.get(day) ?? 0 },
  }));
  return (
    <Panel {...head}>
      <div className="stats">
        <Stat
          label={t("readers")}
          value={f.number(data.readers.total)}
          size="lg"
          hint={t("active7d", { count: data.readers.active7d })}
        />
        <Stat
          label={t("published")}
          value={f.number(data.books.published)}
          hint={t("otherBooks", {
            draft: data.books.draft,
            archived: data.books.archived,
          })}
        />
        <Stat
          label={t("grants")}
          value={f.number(data.grants.inForce)}
          hint={t("grantsHint")}
        />
        <Stat
          label={t("solved")}
          value={f.number(data.exercisesSolved7d)}
          hint={t("solvedHint")}
        />
      </div>
      <DailyBars
        label={t("chart")}
        days={days}
        series={[{ key: "readers", label: t("readersSeries") }]}
        formatValue={(value) => f.number(Math.round(value))}
        // Lower on the section page, so the panel keeps its reserved height.
        height={linked ? 120 : 90}
        // Every third day: the labels never touch, even on a phone.
        labelEvery={3}
      />
    </Panel>
  );
}
