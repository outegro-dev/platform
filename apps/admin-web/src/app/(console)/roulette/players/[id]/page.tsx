import { UserCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BetsTable } from "@/components/roulette/bets-table";
import { Grm } from "@/components/roulette/bits";
import { Time } from "@/components/ui/data";
import { BackLink, Panel, Stat, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getLabels } from "@/lib/labels";
import type { Params } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roulette.player");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One player at the table: turnover, result and the last bets. */
export default async function RoulettePlayerPage({
  params,
}: {
  params: Params<"id">;
}) {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const { id } = await params;
  const t = await getTranslations("roulette.player");
  const label = await getLabels();
  const f = await getFormatter();
  const back = <BackLink href="/roulette/players">{t("back")}</BackLink>;
  const result = UUID.test(id)
    ? await load(() => services().roulette.player(id))
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
  const player = result.data;
  return (
    <>
      <Panel
        id="player"
        kicker={t("kicker")}
        title={player.nickname}
        action={back}
      >
        <div className="row-gap">
          <Status tone={toneOf("user", player.status)}>
            {label("userStatus", player.status)}
          </Status>
          {access.granted.has("users.read") && (
            <Link href={`/users/${player.userId}`} className="panel-link">
              <UserCircleIcon aria-hidden="true" />
              {t("account")}
            </Link>
          )}
        </div>
        <div className="stats">
          <Stat label={t("bets")} value={f.number(player.bets)} />
          <Stat
            label={t("staked")}
            value={<Grm amount={player.staked} locale={f.locale} />}
            hint={t("stakedHint")}
          />
          <Stat
            label={t("paidOut")}
            value={<Grm amount={player.paidOut} locale={f.locale} />}
          />
          <Stat
            label={t("result")}
            value={<Grm amount={player.result} locale={f.locale} sign tone />}
            hint={t("resultHint")}
          />
          <Stat
            label={t("lastBet")}
            value={<Time iso={player.lastBetAt} format="relative" />}
          />
        </div>
      </Panel>
      <Panel id="last-bets" title={t("lastBets")} flush>
        <BetsTable bets={player.lastBets} label={t("lastBets")} show="round" />
      </Panel>
    </>
  );
}
