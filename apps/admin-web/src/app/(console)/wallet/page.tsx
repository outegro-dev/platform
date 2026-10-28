import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DataTable, Time } from "@/components/ui/data";
import { Bars, Panel, PanelLink, Stat } from "@/components/ui/layout";
import { PanelSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { Grumbles } from "@/components/wallet/grumbles";
import { WalletsTable } from "@/components/wallet/wallets-table";
import { pageAccess } from "@/lib/access";
import { txKinds } from "@/lib/adapters/wallet";
import { getLabels } from "@/lib/labels";
import { walletOverview } from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wallet");
  return { title: t("title") };
}

/** Grumbles on hand, the day's operations, the system accounts, the last check. */
async function Overview() {
  const t = await getTranslations("wallet.overview");
  const label = await getLabels();
  const overview = await walletOverview();
  if (!overview.ok) {
    return (
      <Panel
        id="connection"
        title={t("connection")}
        kind={overview.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={overview}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const data = overview.data;
  const total = data.systemAccounts.reduce(
    (sum, account) => sum + BigInt(account.balance),
    BigInt(data.onHand),
  );
  const last = data.lastReconciliation;
  return (
    <>
      <Panel id="now" title={t("now")}>
        <div className="stats">
          <Stat
            label={t("onHand")}
            value={<Grumbles amount={data.onHand} size="lg" />}
            size="lg"
          />
          <Stat label={t("wallets")} value={data.wallets} />
          <Stat
            label={t("restricted")}
            value={data.restricted}
            tone={data.restricted > 0 ? "warn" : undefined}
          />
          <Stat
            label={t("openIssues")}
            value={data.openIssues}
            tone={data.openIssues > 0 ? "bad" : "ok"}
            hint={
              <PanelLink href="/wallet/reconciliation">
                {t("issuesLink")}
              </PanelLink>
            }
          />
          <Stat
            label={t("lastPass")}
            value={
              last?.finishedAt ? (
                <Time iso={last.finishedAt} format="relative" />
              ) : (
                t("never")
              )
            }
            hint={last ? label("runMode", last.mode) : undefined}
          />
        </div>
      </Panel>
      <div className="grid-2">
        <Panel id="day" title={t("day")}>
          <Bars
            label={t("day")}
            items={txKinds.map((kind) => ({
              key: kind,
              label: label("txKind", kind),
              value: data.operations24h[kind],
            }))}
          />
        </Panel>
        <Panel
          flush
          id="turnover"
          title={t("turnover")}
          note={t("turnoverNote")}
        >
          {data.turnover24h.length === 0 ? (
            <p className="muted small">{t("noTurnover")}</p>
          ) : (
            <DataTable label={t("turnover")} stack={false} compact>
              <thead>
                <tr>
                  <th scope="col">{t("colSource")}</th>
                  <th scope="col" className="num">
                    {t("colOperations")}
                  </th>
                  <th scope="col" className="num">
                    {t("colCredited")}
                  </th>
                  <th scope="col" className="num">
                    {t("colDebited")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.turnover24h.map((row) => (
                  <tr key={row.source}>
                    <td>{label("walletSource", row.source)}</td>
                    <td className="num">{row.operations}</td>
                    <td className="num">
                      <Grumbles amount={row.credited} />
                    </td>
                    <td className="num">
                      <Grumbles amount={row.debited} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>
      </div>
      <Panel flush id="system" title={t("system")} note={t("systemNote")}>
        <DataTable label={t("system")} stack={false} compact>
          <thead>
            <tr>
              <th scope="col">{t("colAccount")}</th>
              <th scope="col" className="num">
                {t("colBalance")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.systemAccounts.map((account) => (
              <tr key={account.code}>
                <td>
                  <span className="cell-main">
                    {label("systemAccount", account.code)}
                  </span>
                  <span className="cell-sub mono">{account.code}</span>
                </td>
                <td className="num">
                  <Grumbles amount={account.balance} signed />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">{t("total")}</th>
              <td className="num">
                <Grumbles amount={total.toString()} signed />
              </td>
            </tr>
          </tbody>
        </DataTable>
      </Panel>
    </>
  );
}

export default async function WalletOverviewPage() {
  const access = await pageAccess("wallet.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("wallet.overview");
  return (
    // One boundary: the panels arrive together, so none pushes another down.
    <Suspense
      fallback={
        <>
          <PanelSkeleton label={t("now")} stats={5} rows={0} />
          <TableSkeleton label={t("recent")} rows={6} withFilters={false} />
        </>
      }
    >
      <Overview />
      <WalletsTable
        filter={{}}
        title={t("recent")}
        pager={false}
        limit={8}
        action={<PanelLink href="/wallet/wallets">{t("allWallets")}</PanelLink>}
      />
    </Suspense>
  );
}
