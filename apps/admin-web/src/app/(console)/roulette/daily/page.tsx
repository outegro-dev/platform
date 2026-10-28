import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Grm } from "@/components/roulette/bits";
import { DailyCommand } from "@/components/roulette/daily-command";
import { DataTable, Time } from "@/components/ui/data";
import { Facts, Panel, Stat, Status } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { shortId } from "@/lib/format";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { grm } from "@/lib/roulette";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roulette.daily");
  return { title: t("title") };
}

async function Daily({ granted }: { granted: ReadonlySet<string> }) {
  const t = await getTranslations("roulette.daily");
  const f = await getFormatter();
  const result = await load(() => services().daily.overview());
  if (!result.ok) {
    return (
      <Panel
        id="daily"
        title={t("title")}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const { settings, expectedPrize, last24h, suspicions } = result.data;
  const average = `${new Intl.NumberFormat(f.locale, {
    maximumFractionDigits: 2,
  }).format(expectedPrize)} ${grm}`;
  // The user card when the operator may read users, the player card otherwise.
  const userHref = (id: string) =>
    granted.has("users.read") ? `/users/${id}` : `/roulette/players/${id}`;
  return (
    <>
      <Panel
        id="daily"
        title={t("title")}
        note={t("lead")}
        action={
          <span className="row-gap" style={{ gap: 6 }}>
            <Status tone={settings.enabled ? "ok" : "neutral"}>
              {t(settings.enabled ? "enabled" : "disabled")}
            </Status>
            <Status tone={settings.streaksEnabled ? "info" : "neutral"}>
              {t(settings.streaksEnabled ? "streaksOn" : "streaksOff")}
            </Status>
          </span>
        }
      >
        <div className="stats">
          <Stat
            label={t("expectedPrize")}
            value={<span className="num nowrap">{average}</span>}
            hint={t("expectedHint")}
          />
          <Stat label={t("claims24h")} value={f.number(last24h.claims)} />
          <Stat
            label={t("granted24h")}
            value={<Grm amount={last24h.granted} locale={f.locale} />}
          />
          <Stat
            label={t("suspicionsCount")}
            value={f.number(suspicions.length)}
          />
        </div>
        <Facts
          items={[
            {
              key: "version",
              label: t("version"),
              value: (
                <span>
                  <span className="num">{settings.version}</span>
                  {" · "}
                  <Time iso={settings.updatedAt} />
                </span>
              ),
            },
          ]}
        />
        {granted.has("roulette.manage") ? (
          <div className="row-gap">
            <DailyCommand settings={settings} />
          </div>
        ) : (
          <p className="small muted">{t("readOnly")}</p>
        )}
      </Panel>

      <div className="grid-main">
        <Panel
          id="suspicions"
          title={t("suspicions")}
          note={t("suspicionsNote")}
          flush
        >
          {suspicions.length === 0 ? (
            <EmptyState
              title={t("noSuspicions")}
              body={t("noSuspicionsBody")}
            />
          ) : (
            <DataTable label={t("suspicions")}>
              <thead>
                <tr>
                  <th scope="col">{t("colKind")}</th>
                  <th scope="col">{t("colUsers")}</th>
                  <th scope="col" className="num">
                    {t("colClaims")}
                  </th>
                  <th scope="col">{t("colLast")}</th>
                </tr>
              </thead>
              <tbody>
                {suspicions.map((item) => (
                  <tr key={`${item.kind}-${item.key}`}>
                    <td data-primary="">
                      <span className="cell-main">
                        {t(`kinds.${item.kind}`)}
                      </span>
                      <span className="cell-sub mono" title={item.key}>
                        {shortId(item.key)}
                      </span>
                    </td>
                    <td data-label={t("colUsers")}>
                      <ul className="rl-users" aria-label={t("colUsers")}>
                        {item.users.map((id) => (
                          <li key={id}>
                            <Link
                              href={userHref(id)}
                              className="link mono"
                              prefetch={false}
                              title={id}
                            >
                              {shortId(id)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td data-label={t("colClaims")} className="num">
                      {f.number(item.claims)}
                    </td>
                    <td data-label={t("colLast")}>
                      <Time iso={item.lastAt} format="relative" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>
        <Panel id="prizes" title={t("prizes")} note={t("prizesNote")} flush>
          <DataTable label={t("prizes")} stack={false} compact>
            <thead>
              <tr>
                <th scope="col" className="num">
                  {t("colAmount")}
                </th>
                <th scope="col" className="num">
                  {t("colChance")}
                </th>
              </tr>
            </thead>
            <tbody>
              {settings.prizes.map((prize, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines of a table may repeat; their place is their identity.
                <tr key={index}>
                  <td className="num">
                    <Grm amount={prize.amount} locale={f.locale} />
                  </td>
                  <td className="num">{f.percent(prize.chance, 4)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </>
  );
}

/** The bonus of the day: its prize table, the last day, possible multi-accounts. */
export default async function DailyPage() {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("roulette.daily");
  return (
    <Suspense
      fallback={<PanelSkeleton label={t("title")} stats={4} rows={2} />}
    >
      <Daily granted={access.granted} />
    </Suspense>
  );
}
