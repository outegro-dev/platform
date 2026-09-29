"use client";
// MobX observers read mutable stores during render; the React Compiler's
// memoization would hand back stale JSX, so this file opts out.
"use no memo";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { OrderStatusBadge } from "@/components/status-badge";
import { pick } from "@/lib/i18n";
import { useFormat, useServiceName } from "@/lib/i18n-client";
import { pollOrder } from "@/lib/order-poll";
import type { Localized, Order, Periodicity } from "@/lib/payments/model";
import {
  accessPhase,
  orderTimeline,
  pendingDetail,
} from "@/lib/payments/status";
import { signInPath } from "@/lib/sso";
import { OrderWatchContext, useOrderWatch } from "@/stores/contexts";
import { OrderWatchStore } from "@/stores/order-watch-store";
import {
  type HeroFoot,
  OrderBenefit,
  OrderHero,
  OrderSummary,
  OrderTimeline,
} from "./order-parts";

export type OrderContext = {
  service: string | null;
  serviceUrl: string | null;
  description: Localized | null;
  periodicity: Periodicity | null;
  /** Lava said the buyer cancelled or the payment failed: a hint only. */
  leftPayment: boolean;
  /** Pending for over an hour when the server rendered it. */
  stalePending: boolean;
};

/**
 * The order page body. A pending order is watched live (this is where the
 * buyer lands after Lava); everything below reads the store, so the status,
 * timeline, access and summary change together when the server answers.
 */
export function OrderView({
  initial,
  context,
}: {
  initial: Order;
  context: OrderContext;
}) {
  const [store] = useState(
    () =>
      new OrderWatchStore(initial, {
        load: pollOrder,
        stalePending: context.stalePending,
      }),
  );
  useEffect(() => {
    const online = () => store.setOnline(true);
    const offline = () => store.setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if (navigator.onLine === false) store.setOnline(false);
    store.start();
    return () => {
      store.stop();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [store]);

  return (
    <OrderWatchContext.Provider value={store}>
      <OrderHead />
      <div className="order-layout">
        <div className="order-column">
          <LiveHero context={context} />
          <LiveProgress />
          <LiveBenefit context={context} />
        </div>
        <aside className="order-aside">
          <LiveSummary context={context} />
        </aside>
      </div>
    </OrderWatchContext.Provider>
  );
}

const OrderHead = observer(function OrderHead() {
  const store = useOrderWatch();
  const t = useTranslations("order");
  const locale = useLocale();
  const format = useFormat();
  return (
    <div className="order-head">
      <Link className="back-link" href="/orders">
        <ArrowLeftIcon aria-hidden="true" />
        {t("back")}
      </Link>
      <div className="order-head-meta">
        <span className="og-eyebrow">
          {t("eyebrow", { date: format.date(store.order.createdAt) })}
        </span>
        <OrderStatusBadge phase={store.outcome} />
      </div>
      <h1>{pick(store.order.title, locale)}</h1>
    </div>
  );
});

const LiveHero = observer(function LiveHero({
  context,
}: {
  context: OrderContext;
}) {
  const store = useOrderWatch();
  const locale = useLocale();
  const nameOf = useServiceName();
  const { order, phase, trouble } = store;
  const foot: HeroFoot =
    phase === "signed-out"
      ? "signed-out"
      : phase === "gone"
        ? "gone"
        : trouble === "offline"
          ? "offline"
          : phase === "watching"
            ? trouble === "retrying"
              ? "retrying"
              : "checking"
            : "none";
  const access = order.access;
  return (
    <OrderHero
      outcome={store.outcome}
      detail={pendingDetail(order)}
      leftPayment={context.leftPayment}
      timedOut={phase === "timed-out"}
      animate={phase === "settled" && store.checks > 0}
      foot={foot}
      paymentUrl={
        order.status === "pending" ? (order.checkout?.paymentUrl ?? null) : null
      }
      product={pick(order.title, locale)}
      serviceName={context.service ? nameOf(context.service) : null}
      serviceUrl={context.serviceUrl}
      accessUntil={access?.state === "active" ? access.validUntil : null}
      accessForever={access?.state === "active" && access.validUntil === null}
      subscriptionId={order.subscriptionId}
      signInHref={signInPath(`/orders/${order.id}`)}
      retryHref={`/catalog#${order.productKey}`}
      onCheckAgain={store.checkAgain}
    />
  );
});

const LiveProgress = observer(function LiveProgress() {
  const store = useOrderWatch();
  const t = useTranslations("order");
  return (
    <section
      className="card panel progress-panel"
      aria-labelledby="order-progress-title"
    >
      <h2 id="order-progress-title" className="og-eyebrow">
        {t("progress")}
      </h2>
      <OrderTimeline steps={orderTimeline(store.order)} />
    </section>
  );
});

const LiveBenefit = observer(function LiveBenefit({
  context,
}: {
  context: OrderContext;
}) {
  const store = useOrderWatch();
  const locale = useLocale();
  const nameOf = useServiceName();
  const { order } = store;
  const phase = accessPhase(order);
  const accessDate =
    phase === "active-until" || phase === "expired"
      ? (order.access?.validUntil ?? null)
      : null;
  return (
    <OrderBenefit
      service={context.service}
      serviceName={context.service ? nameOf(context.service) : null}
      serviceUrl={context.serviceUrl}
      title={pick(order.title, locale)}
      kind={order.kind}
      periodicity={context.periodicity}
      description={context.description}
      access={phase}
      accessDate={accessDate}
    />
  );
});

const LiveSummary = observer(function LiveSummary({
  context,
}: {
  context: OrderContext;
}) {
  const store = useOrderWatch();
  const locale = useLocale();
  const nameOf = useServiceName();
  return (
    <OrderSummary
      order={store.order}
      title={pick(store.order.title, locale)}
      serviceName={context.service ? nameOf(context.service) : null}
      periodicity={context.periodicity}
    />
  );
});
