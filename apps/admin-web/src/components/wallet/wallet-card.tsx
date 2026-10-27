import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Pager, Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import { getLabels } from "@/lib/labels";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { Grumbles } from "./grumbles";
import { JournalTable } from "./journal-table";
import { WalletCommands } from "./wallet-commands";

/**
 * One wallet: balance and state, the operator's commands, and the journal
 * page by page. Shared by the wallet page and the user card's tab; `path`
 * is where the journal's pager points.
 */
export async function WalletCard({
  userId,
  cursor,
  canAdjust,
  path,
  title,
  action,
}: {
  userId: string;
  cursor?: string;
  canAdjust: boolean;
  path: string;
  title: string;
  action?: ReactNode;
}) {
  const t = await getTranslations("wallet.card");
  const label = await getLabels();
  const result = await load(() => services().wallet.wallet(userId, { cursor }));
  if (!result.ok) {
    return (
      <Panel
        id="wallet"
        title={title}
        action={action}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState failure={result} what={t("what")} service={t("title")} />
      </Panel>
    );
  }
  const { wallet, history } = result.data;
  return (
    <div className="stack">
      <Panel
        id="wallet"
        title={title}
        note={wallet.exists ? undefined : t("noWallet")}
        action={
          canAdjust ? (
            <div className="row-gap">
              {action}
              <WalletCommands wallet={wallet} />
            </div>
          ) : (
            action
          )
        }
      >
        <Facts
          items={[
            {
              key: "balance",
              label: t("balance"),
              value: <Grumbles amount={wallet.balance} size="lg" />,
            },
            {
              key: "state",
              label: t("state"),
              value: (
                <span className="row-gap">
                  <Status tone={wallet.state === "active" ? "ok" : "warn"}>
                    {label("walletState", wallet.state)}
                  </Status>
                  {wallet.restrictedReason &&
                    label("walletReason", wallet.restrictedReason)}
                </span>
              ),
            },
            {
              key: "operations",
              label: t("operations"),
              value: <span className="num">{wallet.version}</span>,
            },
            {
              key: "updated",
              label: t("updated"),
              value: <Time iso={wallet.updatedAt} />,
            },
          ]}
        />
      </Panel>
      <Panel flush id="journal" title={t("journal")} note={t("journalNote")}>
        {history.items.length === 0 ? (
          <EmptyState size="sm" title={t("empty")} />
        ) : (
          <JournalTable rows={history.items} />
        )}
        <Pager
          path={path}
          params={{ cursor }}
          nextCursor={history.nextCursor}
          shown={history.items.length}
        />
      </Panel>
    </div>
  );
}
