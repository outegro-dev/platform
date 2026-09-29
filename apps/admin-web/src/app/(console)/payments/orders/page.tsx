import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  DataTable,
  FilterBar,
  Pager,
  SelectField,
  TextField,
  Time,
} from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { type OrderFilter, orderStatuses } from "@/lib/adapters/payments";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";
import { paymentsCatalog } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.orders");
  return { title: t("title") };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function OrdersTable({
  filter,
  raw,
}: {
  filter: OrderFilter;
  raw: Record<string, string | undefined>;
}) {
  const t = await getTranslations("payments.orders");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().payments.orders({ ...filter, limit: 25 }),
  );
  if (!result.ok) {
    return (
      <Panel
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
  const filtered = Boolean(
    filter.status ||
      filter.productKey ||
      filter.userId ||
      filter.from ||
      filter.to,
  );
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          search={filtered}
          title={filtered ? t("noMatch") : t("empty")}
          body={filtered ? t("noMatchBody") : t("emptyBody")}
        />
      </Panel>
    );
  }
  const lang = f.locale === "ru" ? "ru" : "en";
  return (
    <Panel flush id="orders" title={t("listTitle")}>
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colProduct")}</th>
            <th scope="col" className="num">
              {t("colAmount")}
            </th>
            <th scope="col">{t("colStatus")}</th>
            <th scope="col">{t("colBuyer")}</th>
            <th scope="col">{t("colCreated")}</th>
            <th scope="col">{t("colPaid")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((order) => (
            <tr key={order.id}>
              <td data-primary="">
                <Link
                  href={`/payments/orders/${order.id}`}
                  className="row-link cell-main"
                  prefetch={false}
                >
                  {order.title[lang]}
                </Link>
                <span className="cell-sub mono">
                  {shortId(order.id)} · {label("productKind", order.kind)}
                </span>
              </td>
              <td data-label={t("colAmount")} className="num nowrap">
                {f.money(order.money)}
              </td>
              <td data-label={t("colStatus")}>
                <Status tone={toneOf("order", order.status)}>
                  {label("order", order.status)}
                </Status>
              </td>
              <td data-label={t("colBuyer")}>
                {order.userId ? (
                  <Link
                    href={`/users/${order.userId}`}
                    className="link mono above"
                    prefetch={false}
                  >
                    {shortId(order.userId)}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td data-label={t("colCreated")}>
                <Time iso={order.createdAt} />
              </td>
              <td data-label={t("colPaid")}>
                <Time iso={order.paidAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/payments/orders"
        params={raw}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("payments.orders");
  const label = await getLabels();
  const f = await getFormatter();
  const catalog = await paymentsCatalog();
  const fromDay = one(params, "from");
  const toDay = one(params, "to");
  const raw = {
    status: oneOf(params, "status", orderStatuses),
    productKey: one(params, "productKey"),
    userId: uuidParam(params, "userId"),
    from: fromDay && DATE.test(fromDay) ? fromDay : undefined,
    to: toDay && DATE.test(toDay) ? toDay : undefined,
    cursor: one(params, "cursor"),
  };
  const filter: OrderFilter = {
    ...raw,
    from: raw.from ? `${raw.from}T00:00:00.000Z` : undefined,
    // "To" includes the whole day.
    to: raw.to
      ? new Date(
          Date.parse(`${raw.to}T00:00:00.000Z`) + 86_400_000,
        ).toISOString()
      : undefined,
  };
  const active = Boolean(
    raw.status || raw.productKey || raw.userId || raw.from || raw.to,
  );
  const lang = f.locale === "ru" ? "ru" : "en";
  return (
    <>
      <Panel id="order-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/payments/orders"
          label={t("filters")}
          active={active}
          inline
        >
          <SelectField
            name="status"
            label={t("status")}
            value={raw.status}
            allLabel={t("anyStatus")}
            options={orderStatuses.map((status) => ({
              value: status,
              label: label("order", status),
            }))}
          />
          {catalog.ok ? (
            <SelectField
              name="productKey"
              label={t("product")}
              value={raw.productKey}
              allLabel={t("anyProduct")}
              options={catalog.data.products.map((product) => ({
                value: product.key,
                label: product.title[lang],
              }))}
            />
          ) : (
            <TextField
              name="productKey"
              label={t("product")}
              value={raw.productKey}
              type="text"
            />
          )}
          <TextField
            name="userId"
            label={t("userId")}
            value={raw.userId}
            placeholder={t("userIdPlaceholder")}
            type="text"
          />
          <TextField
            name="from"
            label={t("from")}
            value={raw.from}
            type="date"
          />
          <TextField name="to" label={t("to")} value={raw.to} type="date" />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(raw)}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <OrdersTable filter={filter} raw={raw} />
      </Suspense>
    </>
  );
}
