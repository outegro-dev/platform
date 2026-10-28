import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { RetryButton } from "@/components/ui/retry-button";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roulette.services");
  return { title: t("title") };
}

/** Frames come four times a second: older than this, the engine is stuck. */
const STALE_TICK_MS = 2000;

async function Services() {
  const t = await getTranslations("roulette.services");
  const f = await getFormatter();
  const result = await load(() => services().roulette.services());
  if (!result.ok) {
    return (
      <Panel
        id="services"
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
  const { services: list, leader, tickAgeMs, wallet } = result.data;
  const down = list.filter((item) => item.status === "down").length;
  const leaseLeft = leader ? Math.max(0, leader.leaseMs) : null;
  return (
    <>
      {wallet === "memory" && (
        <div className="notice" data-tone="warn" role="status">
          <WarningIcon aria-hidden="true" />
          <span>{t("walletMemory")}</span>
        </div>
      )}
      <Panel
        id="services"
        title={down > 0 ? t("titleDown", { count: down }) : t("title")}
        note={t("lead")}
        action={<RetryButton label={t("checkAgain")} />}
      >
        <ul className="health-grid rl-health">
          {list.map((item) => (
            <li key={item.name} className="health">
              <div className="health-head">
                <span className="health-name">{t(`names.${item.name}`)}</span>
                <Status tone={toneOf("serviceStatus", item.status)}>
                  {t(`status.${item.status}`)}
                </Status>
              </div>
              <p className="health-meta">
                {item.latencyMs === null
                  ? t("noAnswer")
                  : t("latency", { ms: item.latencyMs })}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel id="engine" title={t("engine")} note={t("engineNote")}>
        <Facts
          cols={2}
          items={[
            {
              key: "leader",
              label: t("leader"),
              value: leader ? (
                <span className="mono">{leader.instance}</span>
              ) : (
                <Status tone="bad">{t("noLeader")}</Status>
              ),
            },
            {
              key: "lease",
              label: t("lease"),
              value:
                leaseLeft === null ? (
                  <span className="muted">—</span>
                ) : leaseLeft === 0 ? (
                  <Status tone="bad">{t("leaseExpired")}</Status>
                ) : (
                  <span className="num">{f.duration(leaseLeft)}</span>
                ),
            },
            {
              key: "tick",
              label: t("tick"),
              value:
                tickAgeMs === null ? (
                  <Status tone="warn">{t("noTick")}</Status>
                ) : tickAgeMs > STALE_TICK_MS ? (
                  <Status tone="warn">{t("tickAge", { ms: tickAgeMs })}</Status>
                ) : (
                  <span className="num">{t("tickAge", { ms: tickAgeMs })}</span>
                ),
            },
            {
              key: "wallet",
              label: t("wallet"),
              value: (
                <Status tone={wallet === "memory" ? "warn" : "ok"}>
                  {t(`walletModes.${wallet}`)}
                </Status>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

/** Whether the roulette's services are up, who runs the engine, the wallet. */
export default async function RouletteServicesPage() {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("roulette.services");
  return (
    <Suspense
      fallback={<PanelSkeleton label={t("title")} stats={4} rows={2} />}
    >
      <Services />
    </Suspense>
  );
}
