import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { DailyBars } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/data";
import { Panel, Stat, Status } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { dayLabel, lastDays, minorToDecimal } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { oneOf, type SearchParams } from "@/lib/params";
import {
  openIssues,
  paymentsCatalog,
  paymentsStats,
  unmatchedEvents,
} from "@/lib/queries";
import { getFormatter } from "@/lib/request";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments");
  return { title: t("title") };
}

const RANGES = ["7", "30", "90"] as const;

async function Sales() {
  const t = await getTranslations("payments.overview");
  const [catalog, issues, unmatched] = await Promise.all([
    paymentsCatalog(),
    openIssues(),
    unmatchedEvents(),
  ]);
  if (!catalog.ok) {
    return (
      <Panel
        id="sales"
        title={t("sales")}
        kind={catalog.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={catalog}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const open = catalog.data.checkoutEnabled;
  return (
    <Panel id="sales" kicker={t("kicker")} title={t("sales")}>
      <div className="stats">
        <Stat
          label={t("checkout")}
          value={
            <Status tone={open ? "ok" : "warn"}>
              {open ? t("salesOpen") : t("salesClosed")}
            </Status>
          }
          hint={open ? t("salesOpenHint") : t("salesClosedHint")}
        />
        <Stat label={t("products")} value={catalog.data.products.length} />
        <Stat
          label={t("openIssues")}
          value={issues.ok ? issues.data.items.length : "—"}
          tone={issues.ok && issues.data.items.length > 0 ? "warn" : undefined}
          hint={
            <Link href="/payments/issues" className="link">
              {t("review")}
            </Link>
          }
        />
        <Stat
          label={t("unmatched")}
          value={unmatched.ok ? unmatched.data.items.length : "—"}
          tone={
            unmatched.ok && unmatched.data.items.length > 0 ? "warn" : undefined
          }
          hint={
            <Link href="/payments/events?status=unmatched" className="link">
              {t("review")}
            </Link>
          }
        />
      </div>
    </Panel>
  );
}

async function Stats({ range }: { range: (typeof RANGES)[number] }) {
  const t = await getTranslations("payments.overview");
  const f = await getFormatter();
  const from = new Date(f.now - Number(range) * 86_400_000).toISOString();
  const result = await paymentsStats(from);
  if (!result.ok) {
    return (
      <Panel
        id="stats"
        title={t("revenue")}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("whatStats")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const data = result.data;
  const days = lastDays(Number(range), Date.parse(data.to));
  const currencies = data.revenue.totals.map((total) => total.currency);
  const major = (money: { minor: string; scale: number } | null) =>
    money ? Number(minorToDecimal(money.minor, money.scale)) : 0;
  return (
    <>
      <Panel
        id="stats"
        title={t("revenue")}
        note={t("period", { from: f.date(data.from), to: f.date(data.to) })}
      >
        {data.revenue.totals.length === 0 ? (
          <EmptyState
            size="sm"
            title={t("noRevenue")}
            body={t("noRevenueBody")}
          />
        ) : (
          <div className="stats">
            {data.revenue.totals.map((total) => (
              <Stat
                key={total.currency}
                label={t("netIn", { currency: total.currency })}
                value={total.net ? f.money(total.net) : "—"}
                size="lg"
                hint={t("grossRefunded", {
                  gross: total.gross ? f.money(total.gross) : "—",
                  refunded: total.refunded ? f.money(total.refunded) : "—",
                  count: total.payments,
                })}
              />
            ))}
          </div>
        )}
        <p className="small muted">{t("currencyNote")}</p>
      </Panel>
      {currencies.length > 0 && (
        <div className="grid-auto">
          {currencies.map((currency) => {
            const rows = new Map(
              data.revenue.byDay
                .filter((row) => row.currency === currency)
                .map((row) => [row.day, row]),
            );
            const sample = data.revenue.totals.find(
              (total) => total.currency === currency,
            )?.gross;
            const scale = sample?.scale ?? 2;
            const format = (value: number) =>
              new Intl.NumberFormat(f.locale, {
                style: "currency",
                currency,
                currencyDisplay: "narrowSymbol",
                notation: value >= 10_000 ? "compact" : "standard",
                maximumFractionDigits: value >= 100 ? 0 : scale,
              }).format(value);
            return (
              <Panel
                key={currency}
                id={`chart-${currency}`}
                kicker={currency}
                title={t("byDay")}
              >
                <DailyBars
                  label={t("byDayIn", { currency })}
                  days={days.map((day) => {
                    const row = rows.get(day);
                    return {
                      day,
                      label: dayLabel(day, f.locale),
                      values: {
                        net: major(row?.net ?? null),
                        refunded: major(row?.refunded ?? null),
                      },
                    };
                  })}
                  series={[
                    { key: "net", label: t("net") },
                    { key: "refunded", label: t("refunded"), tone: "bad" },
                  ]}
                  formatValue={format}
                  labelEvery={range === "7" ? 1 : range === "30" ? 7 : 21}
                />
              </Panel>
            );
          })}
        </div>
      )}
      <div className="grid-2">
        <Panel id="subscriptions" title={t("subscriptions")}>
          <Stat
            label={t("activeSubscriptions")}
            value={f.number(data.activeSubscriptions.total)}
            size="lg"
          />
          {data.activeSubscriptions.byProduct.length > 0 && (
            <ul className="stack-sm">
              {data.activeSubscriptions.byProduct.map((row) => (
                <li
                  key={row.productKey}
                  className="row-gap"
                  style={{ justifyContent: "space-between" }}
                >
                  <span className="mono small">{row.productKey}</span>
                  <span className="num">{f.number(row.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          flush
          id="conversion"
          title={t("conversion")}
          note={t("conversionNote")}
        >
          {data.conversion.length === 0 ? (
            <EmptyState size="sm" title={t("noCheckouts")} />
          ) : (
            <DataTable label={t("conversion")}>
              <thead>
                <tr>
                  <th scope="col">{t("product")}</th>
                  <th scope="col" className="num">
                    {t("checkouts")}
                  </th>
                  <th scope="col" className="num">
                    {t("paid")}
                  </th>
                  <th scope="col" className="num">
                    {t("failed")}
                  </th>
                  <th scope="col" className="num">
                    {t("rate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.conversion.map((row) => (
                  <tr key={row.productKey}>
                    <td data-primary="">
                      <span className="cell-main mono">{row.productKey}</span>
                      {row.pending > 0 && (
                        <span className="cell-sub">
                          {t("pending", { count: row.pending })}
                        </span>
                      )}
                    </td>
                    <td data-label={t("checkouts")} className="num">
                      {f.number(row.checkouts)}
                    </td>
                    <td data-label={t("paid")} className="num">
                      {f.number(row.paid)}
                    </td>
                    <td data-label={t("failed")} className="num">
                      {f.number(row.failed)}
                    </td>
                    <td data-label={t("rate")} className="num">
                      {row.checkouts > 0
                        ? f.percent(row.paid / row.checkouts)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}

/**
 * While Payments is not connected (unset, or not answering) the overview is
 * one calm panel instead of one per section. The catalog read is the
 * cheapest probe, and the Sales panel reuses it from the request cache.
 */
async function WhenConnected({ children }: { children: ReactNode }) {
  const catalog = await paymentsCatalog();
  if (catalog.ok || catalog.kind !== "not-connected") return children;
  const t = await getTranslations("payments.overview");
  return (
    <Panel id="connection" title={t("connection")} kind="not-connected">
      <FailureState failure={catalog} what={t("what")} service={t("service")} />
    </Panel>
  );
}

async function CatalogPanel() {
  const t = await getTranslations("payments.catalog");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await paymentsCatalog();
  if (!result.ok) return null;
  const lang = f.locale === "ru" ? "ru" : "en";
  return (
    <Panel
      id="catalog"
      kicker={t("kicker")}
      title={t("title")}
      note={t("note")}
    >
      {result.data.products.length === 0 ? (
        <EmptyState size="sm" title={t("empty")} />
      ) : (
        <div className="grid-auto">
          {result.data.products.map((product) => (
            <article
              key={product.key}
              className="health"
              style={{ minHeight: 0 }}
            >
              <div className="health-head">
                <span className="row-gap" style={{ gap: 10 }}>
                  <StorefrontIcon aria-hidden="true" size={20} />
                  <h3 className="health-name">{product.title[lang]}</h3>
                </span>
                <span className="chip" data-tone="muted">
                  {label("productKind", product.kind)}
                </span>
              </div>
              <p className="health-meta">{product.description[lang]}</p>
              <ul className="row-gap">
                {product.prices.map((price) => (
                  <li key={price.priceId} className="chip">
                    {f.money(price.money)}
                    <span className="muted">v{price.version}</span>
                  </li>
                ))}
              </ul>
              <p className="small muted">
                <span className="mono">{product.key}</span> ·{" "}
                {label("periodicity", product.periodicity)} ·{" "}
                <span className="mono">
                  {product.service}/{product.feature}
                </span>
                {product.graceDays > 0 && (
                  <> · {t("grace", { count: product.graceDays })}</>
                )}
              </p>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default async function PaymentsOverviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const range = oneOf(params, "range", RANGES) ?? "30";
  const t = await getTranslations("payments.overview");
  return (
    <Suspense
      fallback={
        <PanelSkeleton label={t("sales")} rows={0} className="h-panel-sm" />
      }
    >
      <WhenConnected>
        <Sales />
        <nav className="segmented self-start" aria-label={t("rangeLabel")}>
          {RANGES.map((value) => (
            <Link
              key={value}
              href={value === "30" ? "/payments" : `/payments?range=${value}`}
              aria-current={value === range ? "true" : undefined}
            >
              {t("days", { count: Number(value) })}
            </Link>
          ))}
        </nav>
        <Suspense
          key={range}
          fallback={
            <PanelSkeleton
              label={t("revenue")}
              chart
              rows={2}
              className="h-panel"
            />
          }
        >
          <Stats range={range} />
        </Suspense>
        <Suspense
          fallback={<PanelSkeleton label={t("sales")} stats={0} rows={3} />}
        >
          <CatalogPanel />
        </Suspense>
      </WhenConnected>
    </Suspense>
  );
}
