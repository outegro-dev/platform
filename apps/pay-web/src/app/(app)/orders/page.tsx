import { Button } from "@outegro/ui/button";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  CloudSlashIcon,
  ReceiptIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { RetryButton } from "@/components/retry-button";
import { ServiceMark } from "@/components/service-mark";
import { StatePanel } from "@/components/state-panel";
import { OrderStatusBadge } from "@/components/status-badge";
import { payments, requireToken } from "@/lib/api";
import { pick } from "@/lib/i18n";
import { getFormat, getServiceName } from "@/lib/i18n-server";
import type { Order } from "@/lib/payments/model";
import { orderPhase } from "@/lib/payments/status";
import { orderIdFrom, returnPath } from "@/lib/routes";
import { signInPath } from "@/lib/sso";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("orders");
  return { title: t("metaTitle") };
}

const PAGE_SIZE = 20;

export default async function OrdersPage({
  searchParams,
}: PageProps<"/orders">) {
  const params = await searchParams;
  // Back from Lava through an older return address: /orders?orderId=…
  // opens that order; the server, not `result`, decides its status.
  const orderId = orderIdFrom(params);
  if (orderId) redirect(returnPath(params));

  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  const from = cursor
    ? `/orders?cursor=${encodeURIComponent(cursor)}`
    : "/orders";
  const token = await requireToken(from);
  const [orders, catalog] = await Promise.all([
    payments.orders(token, { cursor, limit: PAGE_SIZE }),
    payments.catalog(),
  ]);
  if (!orders.ok && orders.error === "unauthorized") redirect(signInPath(from));

  const t = await getTranslations("orders");
  const states = await getTranslations("states");
  const head = (
    <PageHead
      index={t("index")}
      eyebrow={t("eyebrow")}
      title={t("title")}
      accent={t("titleAccent")}
      lead={t("lead")}
    />
  );

  if (!orders.ok) {
    return (
      <>
        {head}
        {orders.error === "invalid" || orders.error === "not-found" ? (
          <StatePanel
            icon={<ClockCounterClockwiseIcon />}
            title={states("invalidTitle")}
            body={states("invalidBody")}
            actions={
              <Button asChild size="lg" variant="outline">
                <Link href="/orders">{states("invalidAction")}</Link>
              </Button>
            }
          />
        ) : (
          <StatePanel
            tone="danger"
            role="alert"
            icon={<CloudSlashIcon />}
            title={states("unavailableTitle")}
            body={t("unavailableBody")}
            actions={<RetryButton />}
          />
        )}
      </>
    );
  }

  const { items, nextCursor } = orders.data;
  if (items.length === 0 && !cursor) {
    return (
      <>
        {head}
        <StatePanel
          icon={<ReceiptIcon />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          actions={
            <Button asChild size="lg">
              <Link href="/catalog">
                {t("emptyAction")}
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  // Which app each product belongs to: from the catalog, else the grant.
  const services = new Map(
    catalog.ok ? catalog.data.products.map((p) => [p.key, p.service]) : [],
  );
  const serviceOf = (order: Order) =>
    services.get(order.productKey) ?? order.access?.service ?? null;

  return (
    <>
      {head}
      <section aria-label={t("listLabel")} className="order-list">
        <div className="list-head og-eyebrow" aria-hidden="true">
          <span />
          <span>{t("listLabel")}</span>
          <span>{t("date")}</span>
          <span>{t("amount")}</span>
          <span>{t("status")}</span>
          <span />
        </div>
        <ul className="order-list">
          {items.map((order) => (
            <OrderRow key={order.id} order={order} service={serviceOf(order)} />
          ))}
        </ul>
      </section>
      {(cursor || nextCursor) && (
        <nav className="pager" aria-label={t("pages")}>
          {cursor && (
            <Button asChild variant="ghost">
              <Link href="/orders">
                <ArrowLeftIcon aria-hidden="true" />
                {t("latest")}
              </Link>
            </Button>
          )}
          {nextCursor && (
            <Button asChild variant="outline">
              <Link href={`/orders?cursor=${encodeURIComponent(nextCursor)}`}>
                {t("older")}
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
          )}
        </nav>
      )}
    </>
  );
}

async function OrderRow({
  order,
  service,
}: {
  order: Order;
  service: string | null;
}) {
  const locale = await getLocale();
  const t = await getTranslations("orders");
  const kinds = await getTranslations("kinds");
  const format = await getFormat();
  const nameOf = await getServiceName();
  const title = pick(order.title, locale);
  return (
    <li>
      <article className="card order-row">
        <ServiceMark service={service} />
        <div className="order-main">
          <h2 className="order-title">
            <Link href={`/orders/${order.id}`}>{title}</Link>
          </h2>
          <p className="order-meta og-eyebrow">
            {service ? `${nameOf(service)} · ` : ""}
            {kinds(order.kind)}
          </p>
        </div>
        <div className="order-cell order-cell-date">
          <span className="sr-only">{t("date")}: </span>
          <time className="order-date nums" dateTime={order.createdAt}>
            {format.date(order.createdAt)}
          </time>
        </div>
        <div className="order-cell order-cell-amount">
          <span className="sr-only">{t("amount")}: </span>
          <span className="order-amount nums">{format.money(order.money)}</span>
        </div>
        <div className="order-cell order-cell-status">
          <span className="sr-only">{t("status")}: </span>
          <span className="order-status">
            <OrderStatusBadge phase={orderPhase(order)} />
          </span>
        </div>
        <CaretRightIcon className="order-chevron" aria-hidden="true" />
      </article>
    </li>
  );
}
