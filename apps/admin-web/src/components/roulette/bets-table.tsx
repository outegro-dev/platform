import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataTable, Time } from "@/components/ui/data";
import { Status } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import type { BetView } from "@/lib/adapters/roulette";
import { getLabels } from "@/lib/labels";
import { getFormatter } from "@/lib/request";
import { toneOf } from "@/lib/tones";
import { ColorChip, Grm } from "./bits";

/**
 * Bets of a round (with the player) or of a player (with the round): the
 * colour, the stake, what became of it and what it paid.
 */
export async function BetsTable({
  bets,
  label,
  show,
}: {
  bets: BetView[];
  label: string;
  show: "player" | "round";
}) {
  const t = await getTranslations("roulette.bets");
  const labels = await getLabels();
  const f = await getFormatter();
  if (bets.length === 0) {
    return <EmptyState size="sm" title={t("empty")} />;
  }
  return (
    <DataTable label={label}>
      <thead>
        <tr>
          <th scope="col">
            {show === "player" ? t("colPlayer") : t("colRound")}
          </th>
          <th scope="col">{t("colColor")}</th>
          <th scope="col" className="num">
            {t("colAmount")}
          </th>
          <th scope="col">{t("colStatus")}</th>
          <th scope="col" className="num">
            {t("colPayout")}
          </th>
          <th scope="col">{t("colAt")}</th>
        </tr>
      </thead>
      <tbody>
        {bets.map((bet) => (
          <tr key={bet.betId}>
            <td data-primary="">
              {show === "player" ? (
                <Link
                  href={`/roulette/players/${bet.userId}`}
                  className="link cell-main"
                  prefetch={false}
                >
                  {bet.nickname}
                </Link>
              ) : (
                <Link
                  href={`/roulette/rounds/${bet.round}`}
                  className="link cell-main num"
                  prefetch={false}
                >
                  {t("roundNo", { round: bet.round })}
                </Link>
              )}
            </td>
            <td data-label={t("colColor")}>
              <ColorChip
                color={bet.color}
                label={labels("rouletteColor", bet.color)}
              />
            </td>
            <td data-label={t("colAmount")} className="num">
              <Grm amount={bet.amount} locale={f.locale} />
            </td>
            <td data-label={t("colStatus")}>
              <Status tone={toneOf("rouletteBet", bet.status)}>
                {labels("rouletteBet", bet.status)}
              </Status>
            </td>
            <td data-label={t("colPayout")} className="num">
              {bet.payout === null ? (
                <span className="muted">—</span>
              ) : (
                <Grm amount={bet.payout} locale={f.locale} />
              )}
            </td>
            <td data-label={t("colAt")}>
              <Time iso={bet.createdAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
