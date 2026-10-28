import { getLocale, getTranslations } from "next-intl/server";
import { Actor } from "@/components/audit/actor";
import { DataTable, Time } from "@/components/ui/data";
import type { WalletTx } from "@/lib/adapters/wallet";
import { getLabels } from "@/lib/labels";
import { formatGrumbles, Grumbles } from "./grumbles";
import { pairs } from "./pairs";

/**
 * A wallet's journal, newest first: what happened, how it moved the
 * balance (before → after), and who did it and why. Each says its source
 * (roulette, daily bonus, the shop, pay, the console) and the object it is
 * about; operations from the internal API have no operator.
 */
export async function JournalTable({ rows }: { rows: WalletTx[] }) {
  const t = await getTranslations("wallet.card");
  const label = await getLabels();
  const locale = await getLocale();
  return (
    <DataTable label={t("journal")}>
      <thead>
        <tr>
          <th scope="col">{t("colWhen")}</th>
          <th scope="col">{t("colKind")}</th>
          <th scope="col" className="num">
            {t("colAmount")}
          </th>
          <th scope="col">{t("colBalance")}</th>
          <th scope="col">{t("colWho")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td data-primary="">
              <Time iso={row.createdAt} />
            </td>
            <td data-label={t("colKind")}>
              {/* One block: on a phone the cell is a label and a value, and
                  the value's lines stay under each other. */}
              <span>
                <span className="cell-main">{label("txKind", row.kind)}</span>
                <span className="cell-sub">
                  {label("walletSource", row.source)}
                  {row.objectRef && (
                    <>
                      {" · "}
                      <span className="mono">{row.objectRef}</span>
                    </>
                  )}
                </span>
                {/* A long ref breaks anywhere only on a phone; a table
                    column keeps it whole between its hyphens. */}
                <span className="cell-sub mono max-[719px]:break-all">
                  {row.ref}
                </span>
              </span>
            </td>
            <td data-label={t("colAmount")} className="num">
              <Grumbles amount={row.amount} signed />
            </td>
            <td data-label={t("colBalance")} className="num nowrap">
              {formatGrumbles(row.balanceBefore, locale)} →{" "}
              {formatGrumbles(row.balanceAfter, locale)}
            </td>
            <td data-label={t("colWho")}>
              <span>
                <span className="cell-main">
                  {row.actorId ? (
                    <Actor id={row.actorId} />
                  ) : (
                    <span className="muted">{t("byService")}</span>
                  )}
                </span>
                {row.reason && <span className="cell-sub">{row.reason}</span>}
                {row.meta && (
                  <span className="cell-sub">{pairs(row.meta)}</span>
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
