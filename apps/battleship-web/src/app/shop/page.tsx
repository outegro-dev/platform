import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ShopView } from "@/components/shop/shop-view";
import { loadSubscriptions, payments } from "@/lib/api";
import { currentPremium, premiumProductKey } from "@/lib/ownership";
import { payLinks } from "@/lib/pay-links";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shop");
  return { title: t("title") };
}

/**
 * Premium and the Silver Fleet from the payments catalog, plus cosmetics.
 * `?orderId=…&result=…` is the return from checkout: wait for the grant.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("shop");
  const locale = (await getLocale()) === "ru" ? "ru" : "en";
  const query = await searchParams;
  // Payments appends ?orderId=…&result=success|failure|cancel on the way back.
  const orderId =
    typeof query.orderId === "string" &&
    /^[0-9A-Za-z-]{8,64}$/.test(query.orderId)
      ? query.orderId
      : null;
  const result =
    query.result === "success" ||
    query.result === "failure" ||
    query.result === "cancel"
      ? query.result
      : null;
  // Renewal and cancellation come from payments; ownership from the game.
  const [catalog, subscriptions] = await Promise.all([
    payments.catalog(locale),
    loadSubscriptions(),
  ]);
  return (
    <main id="main" className="app-main og-container">
      <header className="page-head">
        <p className="og-eyebrow">{t("eyebrow")}</p>
        <h1>
          {t("title")}
          <span className="og-accent">{t("titleAccent")}</span>
        </h1>
        <p>{t("lead")}</p>
      </header>
      <ShopView
        catalog={catalog}
        returned={orderId ? { orderId, result } : null}
        premiumPlan={currentPremium(subscriptions, premiumProductKey(catalog))}
        links={payLinks("/shop")}
      />
    </main>
  );
}
