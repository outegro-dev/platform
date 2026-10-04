import { getTranslations } from "next-intl/server";
import { Panel, Status } from "@/components/ui/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { getLabels } from "@/lib/labels";
import { serviceHealth } from "@/lib/queries";
import { toneOf } from "@/lib/tones";

/** Readiness of every backend from its /health/deep, measured just now. */
export async function HealthPanel() {
  const t = await getTranslations("dashboard.health");
  const label = await getLabels();
  const results = await serviceHealth();
  const down = results.filter((item) => item.state === "down").length;
  return (
    <Panel
      id="health"
      kicker={t("kicker")}
      title={down > 0 ? t("titleDown", { count: down }) : t("title")}
    >
      <ul className="health-grid">
        {results.map((item) => (
          <li key={item.key} className="health">
            <div className="health-head">
              <span className="health-name">{t(`services.${item.key}`)}</span>
              <Status tone={toneOf("health", item.state)}>
                {label("health", item.state)}
              </Status>
            </div>
            <p className="health-meta">
              {item.state === "unconfigured"
                ? t("unconfigured")
                : item.latencyMs === null
                  ? t("noAnswer")
                  : t("latency", { ms: item.latencyMs })}
            </p>
            {item.checks.length > 0 && (
              <ul className="health-deps" aria-label={t("dependencies")}>
                {item.checks.map((check) => (
                  <li
                    key={check.name}
                    className="dep"
                    data-up={check.up ? "true" : "false"}
                    title={check.message ?? undefined}
                  >
                    {check.name}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export async function HealthSkeleton() {
  const t = await getTranslations("dashboard.health");
  return (
    <section className="panel" aria-busy="true" aria-label={t("title")}>
      <div className="panel-heading">
        <Skeleton width={110} height={11} />
        <Skeleton width={200} height={18} />
      </div>
      <div className="health-grid">
        {[
          "identity",
          "notifications",
          "battleship",
          "payments",
          "education",
        ].map((key) => (
          <div key={key} className="health">
            <Skeleton width="70%" height={16} />
            <Skeleton width="40%" height={12} />
            <Skeleton width="80%" height={22} />
          </div>
        ))}
      </div>
    </section>
  );
}
