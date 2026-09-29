"use client";

import { battleshipFeatures } from "@outegro/contracts/battleship";
import { CrownSimpleIcon, SparkleIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { premiumStatus, type SubscriptionSummary } from "@/lib/ownership";
import type { PayLinks } from "@/lib/pay-links";
import { useRoot } from "../providers";
import { PayLink, usePremiumStatusText } from "../shop/ownership";

export type ProfilePurchases = {
  /** The Premium subscription behind the grant, from payments. */
  premiumPlan: SubscriptionSummary | null;
  /** pay.outegro.dev pages that lead back to the profile. */
  links: PayLinks;
  /** The account on id.outegro.dev. */
  accountUrl: string;
};

/**
 * Premium and the Silver Fleet as the account owns them now, with the way
 * to manage them on pay.outegro.dev (or to the shop when there is nothing).
 */
export const PurchasesCard = observer(function PurchasesCard({
  purchases,
}: {
  purchases: ProfilePurchases;
}) {
  const { session } = useRoot();
  const t = useTranslations("profile");
  const shop = useTranslations("shop");
  const statusText = usePremiumStatusText();
  const premium = session.hasFeature(battleshipFeatures.premium);
  const silver = session.hasFeature(battleshipFeatures.silverFleet);
  const { links } = purchases;
  return (
    <section
      className="card"
      aria-labelledby="purchases-title"
      data-testid="purchases-card"
    >
      <div className="stack-sm">
        <h2 id="purchases-title">{t("purchases")}</h2>
        <p>{t("purchasesLead", { host: links.host })}</p>
      </div>
      <ul className="purchase-list">
        <li className="purchase-row">
          <span className="purchase-icon" aria-hidden="true">
            <CrownSimpleIcon weight="fill" />
          </span>
          <span className="purchase-name">{shop("premium.title")}</span>
          <span
            className="purchase-status"
            data-owned={premium || undefined}
            data-testid="profile-premium"
          >
            {statusText(
              premiumStatus({
                owned: premium,
                premiumUntil: session.profile?.premiumUntil,
                subscription: purchases.premiumPlan,
              }),
            )}
          </span>
          <span className="purchase-action">
            {premium ? (
              <PayLink
                href={links.subscriptions}
                testId="profile-manage-subscription"
              >
                {shop("manageSubscription")}
              </PayLink>
            ) : (
              <Link className="pay-link" href="/shop">
                {t("toShop")}
              </Link>
            )}
          </span>
        </li>
        <li className="purchase-row">
          <span className="purchase-icon" aria-hidden="true">
            <SparkleIcon weight="fill" />
          </span>
          <span className="purchase-name">{shop("silver.title")}</span>
          <span
            className="purchase-status"
            data-owned={silver || undefined}
            data-testid="profile-silver"
          >
            {silver ? t("silverOwned") : t("silverOff")}
          </span>
          {silver ? null : (
            <span className="purchase-action">
              <Link className="pay-link" href="/shop">
                {t("toShop")}
              </Link>
            </span>
          )}
        </li>
      </ul>
      <PayLink href={links.purchases} testId="profile-your-purchases">
        {shop("yourPurchases")}
      </PayLink>
    </section>
  );
});
