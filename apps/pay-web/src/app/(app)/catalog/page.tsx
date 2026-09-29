import {
  ArrowSquareOutIcon,
  CloudSlashIcon,
  InfoIcon,
  StorefrontIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ProductCard } from "@/components/catalog/product-card";
import { PageHead } from "@/components/page-head";
import { RetryButton } from "@/components/retry-button";
import { ServiceMark } from "@/components/service-mark";
import { StatePanel } from "@/components/state-panel";
import { payments, requireToken } from "@/lib/api";
import { platformUrls } from "@/lib/env";
import { getServiceName } from "@/lib/i18n-server";
import type { Product } from "@/lib/payments/model";
import { serviceLink } from "@/lib/services";
import { signInPath } from "@/lib/sso";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("catalog");
  return { title: t("metaTitle") };
}

/** Subscriptions the provider may still renew: a second one is refused. */
const renewing = new Set(["active", "past_due", "cancel_requested"]);

/** A currency to preselect; the buyer can switch, nothing is converted. */
function preferredCurrency(product: Product, locale: string) {
  const offered = product.prices.map((price) => price.money.currency);
  const wanted = locale === "ru" ? "RUB" : "USD";
  return offered.includes(wanted) ? wanted : (offered[0] ?? wanted);
}

export default async function CatalogPage() {
  const token = await requireToken("/catalog");
  const [catalog, subscriptions, orders] = await Promise.all([
    payments.catalog(),
    payments.subscriptions(token, { limit: 100 }),
    payments.orders(token, { limit: 100 }),
  ]);
  if (
    (!subscriptions.ok && subscriptions.error === "unauthorized") ||
    (!orders.ok && orders.error === "unauthorized")
  )
    redirect(signInPath("/catalog"));

  const t = await getTranslations("catalog");
  const states = await getTranslations("states");
  const locale = await getLocale();
  const nameOf = await getServiceName();
  const head = (
    <PageHead
      index={t("index")}
      eyebrow={t("eyebrow")}
      title={t("title")}
      accent={t("titleAccent")}
      lead={t("lead")}
    />
  );

  if (!catalog.ok) {
    return (
      <>
        {head}
        <StatePanel
          tone="danger"
          role="alert"
          icon={<CloudSlashIcon />}
          title={states("unavailableTitle")}
          body={t("unavailableBody")}
          actions={<RetryButton />}
        />
      </>
    );
  }

  const products = catalog.data.products.filter((p) => p.prices.length > 0);
  if (products.length === 0) {
    return (
      <>
        {head}
        <StatePanel
          icon={<StorefrontIcon />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        />
      </>
    );
  }

  // Ownership hints; the server still refuses a second copy on its own.
  const subscribed = new Map(
    subscriptions.ok
      ? subscriptions.data.items
          .filter((sub) => renewing.has(sub.state))
          .map((sub) => [sub.productKey, sub.id])
      : [],
  );
  const owned = new Map(
    orders.ok
      ? orders.data.items
          .filter(
            (order) =>
              order.kind === "one_time" &&
              order.status === "paid" &&
              order.access?.state === "active",
          )
          .map((order) => [order.productKey, order.id])
      : [],
  );
  const salesOpen = catalog.data.checkoutEnabled && payments.checkoutConfigured;
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    groups.set(product.service, [
      ...(groups.get(product.service) ?? []),
      product,
    ]);
  }

  return (
    <>
      {head}
      {!salesOpen && (
        <div className="notice" role="status">
          <InfoIcon weight="duotone" aria-hidden="true" />
          <div>
            <strong>{t("closedTitle")}</strong>
            <p>{t("closedBody")}</p>
          </div>
        </div>
      )}
      {[...groups].map(([service, items]) => {
        const link = serviceLink(service, platformUrls);
        const name = nameOf(service);
        return (
          <section
            key={service}
            className="catalog-group"
            aria-labelledby={`service-${service}`}
          >
            <div className="catalog-group-head">
              <div className="group-name">
                <ServiceMark service={service} />
                <h2 id={`service-${service}`}>{name}</h2>
              </div>
              {link && (
                <a className="hero-aside-link" href={link.home}>
                  {t("open", { service: name })}
                  <ArrowSquareOutIcon aria-hidden="true" />
                </a>
              )}
            </div>
            <div className="product-grid">
              {items.map((product) => {
                const subscriptionId = subscribed.get(product.key);
                const orderId = owned.get(product.key);
                return (
                  <ProductCard
                    key={product.key}
                    product={product}
                    defaultCurrency={preferredCurrency(product, locale)}
                    salesOpen={salesOpen}
                    ownership={
                      subscriptionId
                        ? { kind: "subscribed", href: "/subscriptions" }
                        : orderId
                          ? { kind: "owned", href: `/orders/${orderId}` }
                          : null
                    }
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
