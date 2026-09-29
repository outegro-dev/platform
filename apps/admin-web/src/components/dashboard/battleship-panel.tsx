import { getTranslations } from "next-intl/server";
import { Bars, Panel, PanelLink, Stat } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { botLevels, matchModes } from "@/lib/adapters/battleship";
import { battleshipOverview } from "@/lib/queries";
import { getFormatter } from "@/lib/request";

/** On the dashboard it links to the section; on the section page it does not. */
export async function BattleshipPanel({ linked = true }: { linked?: boolean }) {
  const t = await getTranslations("dashboard.battleship");
  const f = await getFormatter();
  const result = await battleshipOverview();
  const head = {
    id: "battleship",
    kicker: t("kicker"),
    title: t("title"),
    action: linked ? (
      <PanelLink href="/battleship">{t("open")}</PanelLink>
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
  const live = matchModes.reduce(
    (sum, mode) => sum + (data.activeMatches[mode] ?? 0),
    0,
  );
  return (
    <Panel {...head}>
      <div className="stats">
        <Stat
          label={t("online")}
          value={f.number(data.playersOnline)}
          size="lg"
          hint={t("sockets", { count: data.socketsOnline })}
        />
        <Stat
          label={t("live")}
          value={f.number(live)}
          hint={t("queue", { count: data.queueSize })}
        />
        <Stat
          label={t("today")}
          value={f.number(data.matchesToday)}
          hint={t("week", { count: data.matches7d })}
        />
        <Stat
          label={t("premium")}
          value={f.number(data.premiumPlayers)}
          hint={t("newPlayers", { count: data.newPlayers7d })}
        />
      </div>
      <div className="grid-2">
        <div className="stack-sm">
          <p className="panel-kicker">{t("byMode")}</p>
          <Bars
            label={t("byMode")}
            items={matchModes.map((mode) => ({
              key: mode,
              label: t(`mode.${mode}`),
              value: data.activeMatches[mode] ?? 0,
              display: f.number(data.activeMatches[mode] ?? 0),
            }))}
          />
        </div>
        <div className="stack-sm">
          <p className="panel-kicker">{t("botRate")}</p>
          <Bars
            label={t("botRate")}
            max={1}
            items={botLevels.map((level) => {
              const row = data.botWinRate[level];
              return {
                key: level,
                label: t(`level.${level}`),
                value: row?.rate ?? 0,
                tone: "muted" as const,
                display:
                  row && row.rate !== null
                    ? `${f.percent(row.rate)} · ${f.number(row.botWins)}/${f.number(row.matches)}`
                    : "—",
              };
            })}
          />
        </div>
      </div>
    </Panel>
  );
}
