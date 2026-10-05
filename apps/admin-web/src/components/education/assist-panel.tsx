import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { Facts, Panel, Stat, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { assistCap, assistShares, assistState } from "@/lib/education";
import { educationOverview } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { toneOf } from "@/lib/tones";

/**
 * Education's AI assistant for readers: the last 7 days of requests (from
 * the cache, failed) and tokens, which is what the model costs, then what
 * readers get now (on, paused by the spending cap, off), each reader's daily
 * limit and today's model calls against the spending cap for all readers.
 * It reads the same overview as the reading numbers (once per request).
 */
export async function AssistPanel() {
  const t = await getTranslations("education.assist");
  const f = await getFormatter();
  const result = await educationOverview();
  const head = { id: "assist", title: t("title"), note: t("note") };
  if (!result.ok) {
    return (
      <Panel
        {...head}
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
  const assist = result.data.assist;
  const shares = assistShares(assist);
  // One decimal at most: a few failures in a busy week read 0.2%, not 0%.
  const ofRequests = (share: number | null) =>
    share === null
      ? undefined
      : t("ofRequests", { share: f.percent(share, 1) });
  const state = assistState(assist);
  const cap = assistCap(assist);
  return (
    <Panel {...head}>
      <div className="stats">
        <Stat
          label={t("requests")}
          value={f.number(assist.requests7d)}
          size="lg"
          hint={t("requestsHint")}
        />
        <Stat
          label={t("cached")}
          value={f.number(assist.cached7d)}
          hint={ofRequests(shares.cached)}
        />
        <Stat
          label={t("failed")}
          value={f.number(assist.failed7d)}
          hint={ofRequests(shares.failed)}
        />
        <Stat
          label={t("tokensIn")}
          value={f.number(assist.tokensIn7d)}
          hint={t("tokensInHint")}
        />
        <Stat
          label={t("tokensOut")}
          value={f.number(assist.tokensOut7d)}
          hint={t("tokensOutHint")}
        />
      </div>
      <Facts
        cols={2}
        items={[
          {
            key: "status",
            label: t("status"),
            value: (
              <span className="stack-xs">
                <span className="self-start">
                  <Status tone={toneOf("assist", state)}>{t(state)}</Status>
                </span>
                <span className="small muted">{t(`${state}Hint`)}</span>
              </span>
            ),
          },
          {
            key: "daily-limit",
            label: t("dailyLimit"),
            value: (
              <span className="stack-xs">
                <span>{t("perReader", { count: assist.dailyLimit })}</span>
                <span className="small muted">{t("resets")}</span>
              </span>
            ),
          },
          {
            key: "spending-cap",
            label: t("globalLimit"),
            value: cap ? (
              <span className="stack-xs">
                {/* Grouped by the formatter: a plain number argument is not. */}
                <span
                  className="fact-value"
                  data-tone={cap.reached ? "warn" : undefined}
                >
                  {cap.reached && <WarningIcon aria-hidden="true" />}
                  {t("globalUsed", {
                    used: f.number(cap.used),
                    limit: cap.limit,
                  })}
                </span>
                <span className="small muted">{t("globalResets")}</span>
              </span>
            ) : (
              <span className="stack-xs">
                <span>{t("noGlobalLimit")}</span>
                <span className="small muted">{t("noGlobalLimitHint")}</span>
              </span>
            ),
          },
        ]}
      />
      <p className="small muted">{t("counts")}</p>
    </Panel>
  );
}
