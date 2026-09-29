import { getTranslations } from "next-intl/server";
import { Panel, PanelLink, Stat, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { paymentsCatalog, paymentsStats } from "@/lib/queries";
import { getFormatter } from "@/lib/request";

export async function PaymentsPanel() {
  const t = await getTranslations("dashboard.payments");
  const f = await getFormatter();
  const [catalog, stats] = await Promise.all([
    paymentsCatalog(),
    paymentsStats(),
  ]);
  const notConnected =
    !catalog.ok && catalog.kind === "not-connected" ? catalog : null;
  const head = {
    id: "payments",
    kicker: t("kicker"),
    title: t("title"),
    action: <PanelLink href="/payments">{t("open")}</PanelLink>,
    className: "h-panel",
    kind: notConnected ? ("not-connected" as const) : undefined,
  };
  if (notConnected) {
    return (
      <Panel {...head}>
        <FailureState
          failure={notConnected}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const sales = catalog.ok ? (
    <Status tone={catalog.data.checkoutEnabled ? "ok" : "warn"}>
      {catalog.data.checkoutEnabled ? t("salesOpen") : t("salesClosed")}
    </Status>
  ) : null;
  if (!stats.ok) {
    return (
      <Panel {...head}>
        {sales && <div className="row-gap">{sales}</div>}
        <FailureState
          failure={stats}
          what={t("whatStats")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const data = stats.data;
  const checkouts = data.conversion.reduce(
    (sum, row) => sum + row.checkouts,
    0,
  );
  const paid = data.conversion.reduce((sum, row) => sum + row.paid, 0);
  return (
    <Panel
      {...head}
      note={t("period", { from: f.date(data.from), to: f.date(data.to) })}
    >
      <div className="row-gap">{sales}</div>
      <div className="stats">
        {data.revenue.totals.length === 0 ? (
          <Stat label={t("revenue")} value={t("noRevenue")} size="sm" />
        ) : (
          data.revenue.totals.map((total) => (
            <Stat
              key={total.currency}
              label={t("net", { currency: total.currency })}
              value={total.net ? f.money(total.net) : "—"}
              hint={t("payments", { count: total.payments })}
            />
          ))
        )}
        <Stat
          label={t("subscriptions")}
          value={f.number(data.activeSubscriptions.total)}
        />
        <Stat
          label={t("conversion")}
          value={checkouts > 0 ? f.percent(paid / checkouts) : "—"}
          hint={t("checkouts", { paid, count: checkouts })}
        />
      </div>
      <p className="small muted">{t("currencyNote")}</p>
    </Panel>
  );
}
