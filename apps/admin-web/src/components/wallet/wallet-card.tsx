import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { FilterBar, Pager, SelectField, Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import { type WalletSource, walletSources } from "@/lib/adapters/wallet";
import { getLabels } from "@/lib/labels";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { Grumbles } from "./grumbles";
import { JournalTable } from "./journal-table";
import { WalletCommands } from "./wallet-commands";

/**
 * One wallet: balance and state, the operator's commands, and the journal
 * page by page, optionally of one source. Shared by the wallet page and the
 * user card's tab: `path` is the page, `params` what it always carries
 * (the user card's tab), so the filter and the pager keep both.
 */
export async function WalletCard({
  userId,
  cursor,
  source,
  canAdjust,
  path,
  params = {},
  title,
  action,
}: {
  userId: string;
  cursor?: string;
  source?: WalletSource;
  canAdjust: boolean;
  path: string;
  params?: Record<string, string>;
  title: string;
  action?: ReactNode;
}) {
  const t = await getTranslations("wallet.card");
  const label = await getLabels();
  const result = await load(() =>
    services().wallet.wallet(userId, { cursor, source }),
  );
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
  const base = new URLSearchParams(params).toString();
  const filterAction = base ? `${path}?${base}` : path;
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
        <FilterBar
          action={filterAction}
          label={t("filters")}
          active={Boolean(source)}
          inline
        >
          {Object.entries(params).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <SelectField
            name="source"
            label={t("source")}
            value={source}
            allLabel={t("anySource")}
            options={walletSources.map((value) => ({
              value,
              label: label("walletSource", value),
            }))}
          />
        </FilterBar>
        {history.items.length === 0 ? (
          <EmptyState size="sm" search={Boolean(source)} title={t("empty")} />
        ) : (
          <JournalTable rows={history.items} />
        )}
        <Pager
          path={path}
          params={{ ...params, source, cursor }}
          nextCursor={history.nextCursor}
          shown={history.items.length}
        />
      </Panel>
    </div>
  );
}
