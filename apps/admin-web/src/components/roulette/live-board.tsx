"use client";

import type { AdminLive } from "@outegro/contracts/roulette";
import { WarningCircleIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { BACKGROUND_HEADER } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { exposureOf, roundTotals } from "@/lib/roulette";
import {
  type LiveAnswer,
  RouletteLiveStore,
} from "@/stores/roulette-live-store";
import { ColorChip, Grm } from "./bits";

/** How often the live table is read while the page is visible. */
export const LIVE_INTERVAL_MS = 2500;

async function read(): Promise<LiveAnswer> {
  const response = await fetch("/api/roulette/live", {
    headers: { [BACKGROUND_HEADER]: "1" },
    cache: "no-store",
    credentials: "same-origin",
    redirect: "manual",
  });
  // The proxy answers 401 itself once the session is over (or idle).
  if (response.status === 401) return { ok: false, kind: "unauthenticated" };
  if (!response.ok) return { ok: false, kind: "unavailable" };
  return (await response.json()) as LiveAnswer;
}

const browserTimers = {
  set: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
  clear: (handle: unknown) => window.clearTimeout(handle as number),
};

function Panel({
  id,
  title,
  note,
  action,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="panel" aria-labelledby={`${id}-title`}>
      <div className="panel-head">
        <div className="panel-heading">
          <h2 className="panel-title" id={`${id}-title`}>
            {title}
          </h2>
          {note && <p className="panel-note">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{children}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

/**
 * The table right now: the round and its phase with the time left, who is
 * online, the bets, what each colour would pay against the limit, and the
 * house's result. Read again every few seconds while the page is visible;
 * a failed read keeps the last numbers on screen and says how old they are.
 */
export const LiveBoard = observer(function LiveBoard({
  initial,
  serverTime,
}: {
  initial: AdminLive;
  serverTime: string;
}) {
  "use no memo";
  const t = useTranslations("roulette.live");
  const labels = useTranslations("labels");
  const locale = useLocale();
  // Server and browser render the first frame at the server's time, so the
  // countdown hydrates as rendered; the clock ticks from the first effect.
  const [store] = useState(
    () =>
      new RouletteLiveStore(
        { read, timers: browserTimers, intervalMs: LIVE_INTERVAL_MS },
        { data: initial, serverTime },
        Date.parse(serverTime),
      ),
  );

  useEffect(() => {
    store.tick(Date.now());
    store.start();
    const onVisibility = () =>
      store.setVisible(document.visibilityState !== "hidden", Date.now());
    document.addEventListener("visibilitychange", onVisibility);
    const clock = window.setInterval(() => store.tick(Date.now()), 1000);
    return () => {
      store.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(clock);
    };
  }, [store]);

  const { round, online, table, exposure, house } = store.data;
  const totals = round ? roundTotals(round) : { count: 0, sum: 0 };
  const left = store.secondsLeft;
  const number = (value: number) => formatNumber(value, locale);
  const colors = exposureOf(exposure, table.payoutLimitPerColor);

  return (
    <>
      {store.failure && (
        <div
          className="notice"
          data-tone={store.stopped ? "bad" : "warn"}
          role="status"
        >
          {store.failure === "unavailable" ||
          store.failure === "not-connected" ? (
            <WifiSlashIcon aria-hidden="true" />
          ) : (
            <WarningCircleIcon aria-hidden="true" />
          )}
          <span style={{ flex: 1 }}>
            {store.failure === "unauthenticated" ? (
              <>
                {t("sessionEnded")}{" "}
                <a
                  className="link"
                  href={`/auth/sign-in?returnTo=${encodeURIComponent("/roulette")}`}
                >
                  {t("signInAgain")}
                </a>
              </>
            ) : store.failure === "forbidden" ? (
              t("forbidden")
            ) : (
              t("stale", { seconds: store.age })
            )}
          </span>
        </div>
      )}

      <Panel
        id="live-round"
        title={round ? t("round", { round: round.round }) : t("noRound")}
        note={t("updated", { seconds: store.age })}
        action={
          <span className="row-gap" style={{ gap: 6 }}>
            {round && (
              <span
                className="status"
                data-tone={
                  round.phase === "voided"
                    ? "bad"
                    : round.phase === "settled"
                      ? "neutral"
                      : "live"
                }
              >
                {labels(`roulettePhase.${round.phase}`)}
              </span>
            )}
            {table.paused && (
              <span className="status" data-tone="warn">
                {t("paused")}
              </span>
            )}
            {table.maintenance && (
              <span className="status" data-tone="warn">
                {t("maintenance")}
              </span>
            )}
          </span>
        }
      >
        <div className="stats">
          <Stat label={t("timeLeft")}>
            <span className="num rl-time-left">
              {left === null ? "—" : t("seconds", { seconds: left })}
            </span>
          </Stat>
          <Stat label={t("online")} hint={t("onlineHint")}>
            {number(online)}
          </Stat>
          <Stat label={t("bets")}>{number(totals.count)}</Stat>
          <Stat label={t("staked")}>
            <Grm amount={totals.sum} locale={locale} />
          </Stat>
          <Stat label={t("result")}>
            {round?.result ? (
              <ColorChip
                color={round.result.color}
                number={round.result.number}
                label={labels(`rouletteColor.${round.result.color}`)}
              />
            ) : (
              <span className="muted">{t("notYet")}</span>
            )}
          </Stat>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel
          id="exposure"
          title={t("exposure")}
          note={t("exposureNote", {
            limit: number(table.payoutLimitPerColor),
          })}
        >
          <ul className="bars rl-exposure" aria-label={t("exposure")}>
            {colors.map((item) => (
              <li
                key={item.color}
                className="bar-row"
                data-near={item.near ? "" : undefined}
              >
                <span className="bar-label">
                  <ColorChip
                    color={item.color}
                    label={labels(`rouletteColor.${item.color}`)}
                  />
                </span>
                <span className="bar-track" aria-hidden="true">
                  <span
                    className="bar-fill"
                    data-tone={item.near ? "bad" : undefined}
                    style={{
                      transform: `scaleX(${Math.min(1, item.ratio)})`,
                    }}
                  />
                </span>
                <span className="bar-value rl-exposure-value">
                  <Grm amount={item.amount} locale={locale} />
                  {" · "}
                  {t("share", { percent: Math.round(item.ratio * 100) })}
                  {item.near && (
                    <span className="status" data-tone="warn">
                      {item.full ? t("atLimit") : t("nearLimit")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="house" title={t("house")} note={t("houseNote")}>
          <div className="rl-house">
            {(["day", "total"] as const).map((period) => {
              const item = house[period];
              return (
                <dl key={period} className="facts">
                  <div className="fact">
                    <dt>{t(period === "day" ? "day" : "total")}</dt>
                    <dd>
                      <Grm amount={item.result} locale={locale} sign tone />
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>{t("rounds")}</dt>
                    <dd className="num">{number(item.rounds)}</dd>
                  </div>
                  <div className="fact">
                    <dt>{t("betsCount")}</dt>
                    <dd className="num">{number(item.bets)}</dd>
                  </div>
                  <div className="fact">
                    <dt>{t("stakedTotal")}</dt>
                    <dd>
                      <Grm amount={item.staked} locale={locale} />
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>{t("paidOut")}</dt>
                    <dd>
                      <Grm amount={item.paidOut} locale={locale} />
                    </dd>
                  </div>
                </dl>
              );
            })}
          </div>
        </Panel>
      </div>
    </>
  );
});
