import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BetsTable } from "@/components/roulette/bets-table";
import { ColorChip, Grm } from "@/components/roulette/bits";
import { VoidCommand } from "@/components/roulette/void-command";
import { CopyText } from "@/components/ui/copy-text";
import { Time } from "@/components/ui/data";
import { BackLink, Facts, Panel, Stat, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getLabels } from "@/lib/labels";
import type { Params } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { isVoidable, roundParam } from "@/lib/roulette";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roulette.round");
  return { title: t("title") };
}

/** A seed as a short readable handle; copied (and shown on hover) whole. */
const short = (seed: string) =>
  seed.length > 24 ? `${seed.slice(0, 12)}…${seed.slice(-6)}` : seed;

export default async function RoundPage({
  params,
}: {
  params: Params<"round">;
}) {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const { round: raw } = await params;
  const t = await getTranslations("roulette.round");
  const label = await getLabels();
  const f = await getFormatter();
  const back = <BackLink href="/roulette/rounds">{t("back")}</BackLink>;
  const round = roundParam(raw);
  const result = round
    ? await load(() => services().roulette.round(round))
    : ({ ok: false, kind: "not-found" } as const);
  if (!result.ok) {
    return (
      <Panel
        action={back}
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
  const detail = result.data;
  const canVoid =
    access.granted.has("roulette.void") && isVoidable(detail.phase);
  const seed = (value: string | null, pending: string) =>
    value ? (
      <CopyText value={value} display={short(value)} label={t("copySeed")} />
    ) : (
      <span className="muted">{pending}</span>
    );

  return (
    <>
      <Panel
        id="round"
        kicker={t("kicker")}
        title={t("roundNo", { round: detail.round })}
        action={back}
      >
        <div className="row-gap">
          <Status tone={toneOf("roulettePhase", detail.phase)}>
            {label("roulettePhase", detail.phase)}
          </Status>
          {detail.color !== null && detail.number !== null && (
            <ColorChip
              color={detail.color}
              number={detail.number}
              label={label("rouletteColor", detail.color)}
            />
          )}
          <span className="small muted">
            {t("opened")} <Time iso={detail.openedAt} />
          </span>
        </div>
        <div className="stats">
          <Stat label={t("bets")} value={f.number(detail.bets)} />
          <Stat
            label={t("staked")}
            value={<Grm amount={detail.staked} locale={f.locale} />}
          />
          <Stat
            label={t("paidOut")}
            value={<Grm amount={detail.paidOut} locale={f.locale} />}
          />
          <Stat
            label={t("house")}
            value={<Grm amount={detail.result} locale={f.locale} sign tone />}
            hint={t("houseHint")}
          />
        </div>
        {canVoid && (
          <div className="row-gap">
            <VoidCommand round={detail.round} />
          </div>
        )}
      </Panel>

      <div className="grid-main">
        <Panel id="top-bets" title={t("topBets")} flush>
          <BetsTable bets={detail.topBets} label={t("topBets")} show="player" />
        </Panel>
        <Panel id="fairness" title={t("fairness")} note={t("fairnessNote")}>
          <Facts
            items={[
              {
                key: "link",
                label: t("link"),
                value:
                  detail.linkVerified === null ? (
                    <Status tone="neutral">{t("linkPending")}</Status>
                  ) : detail.linkVerified ? (
                    <Status tone="ok">{t("linkOk")}</Status>
                  ) : (
                    <Status tone="bad">{t("linkBroken")}</Status>
                  ),
              },
              {
                key: "seed",
                label: t("seed"),
                value: seed(detail.seed, t("seedHidden")),
              },
              {
                key: "previous",
                label: t("previousSeed"),
                value: seed(detail.previousSeed, t("noPrevious")),
              },
              {
                key: "commit",
                label: t("commit"),
                value: seed(detail.commit, "—"),
              },
              {
                key: "public",
                label: t("publicSeed"),
                value: (
                  <CopyText
                    value={detail.publicSeed}
                    display={short(detail.publicSeed)}
                    label={t("copySeed")}
                  />
                ),
              },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
