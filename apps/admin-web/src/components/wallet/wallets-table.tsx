import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { DataTable, Pager, Time } from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import type { WalletFilter } from "@/lib/adapters/wallet";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { Grumbles } from "./grumbles";

/**
 * Wallets, most recently changed first; each row opens the wallet card.
 * Players show as short IDs (no name lookups for a list of many users).
 */
export async function WalletsTable({
  filter,
  title,
  pager = true,
  limit = 25,
  action,
  children,
}: {
  filter: WalletFilter;
  title: string;
  pager?: boolean;
  limit?: number;
  action?: ReactNode;
  /** Filters, above the table. */
  children?: ReactNode;
}) {
  const t = await getTranslations("wallet.wallets");
  const label = await getLabels();
  const result = await load(() =>
    services().wallet.wallets({ ...filter, limit }),
  );
  if (!result.ok) {
    return (
      <Panel
        title={title}
        action={action}
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
  const { items, nextCursor } = result.data;
  return (
    <Panel flush title={title} action={action}>
      {children}
      {items.length === 0 ? (
        <EmptyState
          size="sm"
          search={Boolean(filter.state || filter.userId)}
          title={t("empty")}
          body={t("emptyBody")}
        />
      ) : (
        <DataTable label={title}>
          <thead>
            <tr>
              <th scope="col">{t("colUser")}</th>
              <th scope="col" className="num">
                {t("colBalance")}
              </th>
              <th scope="col">{t("colState")}</th>
              <th scope="col" className="num">
                {t("colOperations")}
              </th>
              <th scope="col">{t("colUpdated")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((wallet) => (
              <tr key={`${wallet.userId}-${wallet.unit}`}>
                <td data-primary="">
                  <Link
                    href={`/wallet/wallets/${wallet.userId}`}
                    className="link mono"
                  >
                    {shortId(wallet.userId)}
                  </Link>
                </td>
                <td data-label={t("colBalance")} className="num">
                  <Grumbles amount={wallet.balance} />
                </td>
                <td data-label={t("colState")}>
                  <Status tone={wallet.state === "active" ? "ok" : "warn"}>
                    {label("walletState", wallet.state)}
                  </Status>
                  {wallet.restrictedReason && (
                    <span className="cell-sub">
                      {label("walletReason", wallet.restrictedReason)}
                    </span>
                  )}
                </td>
                <td data-label={t("colOperations")} className="num">
                  {wallet.version}
                </td>
                <td data-label={t("colUpdated")}>
                  <Time iso={wallet.updatedAt} format="relative" />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {pager && (
        <Pager
          path="/wallet/wallets"
          params={{
            state: filter.state,
            userId: filter.userId,
            cursor: filter.cursor,
          }}
          nextCursor={nextCursor}
          shown={items.length}
        />
      )}
    </Panel>
  );
}
