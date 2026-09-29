"use client";
// MobX observers read mutable stores during render; the React Compiler's
// memoization would hand back stale JSX, so this file opts out.
"use no memo";

import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  LockSimpleIcon,
  SealCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { startCheckout } from "@/app/actions";
import { pick } from "@/lib/i18n";
import { useFormat } from "@/lib/i18n-client";
import type { Product } from "@/lib/payments/model";
import { signInPath } from "@/lib/sso";
import { CheckoutStore, sessionKeyVault } from "@/stores/checkout-store";

type Ownership = { kind: "owned" | "subscribed"; href: string } | null;

/** One product with its price, currency choice and buy button. */
export const ProductCard = observer(function ProductCard({
  product,
  defaultCurrency,
  salesOpen,
  ownership,
}: {
  product: Product;
  defaultCurrency: string;
  salesOpen: boolean;
  ownership: Ownership;
}) {
  const router = useRouter();
  const [store] = useState(
    () =>
      new CheckoutStore(
        {
          key: product.key,
          currencies: product.prices.map((price) => price.money.currency),
        },
        defaultCurrency,
        {
          start: startCheckout,
          keys: sessionKeyVault(),
          newKey: () => `pw-${crypto.randomUUID()}`,
          // Only https pages on CHECKOUT_ORIGINS ever get here (server check).
          navigate: (url) => {
            if (url.startsWith("https://")) window.location.assign(url);
          },
          openOrder: (orderId) => router.push(`/orders/${orderId}`),
          wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
      ),
  );
  useEffect(() => {
    // Back from the payment page via the back button (page cache).
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) store.resumeAfterReturn();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [store]);

  const t = useTranslations("catalog");
  const kinds = useTranslations("kinds");
  const periodic = useTranslations("periodic");
  const periods = useTranslations("periods");
  const locale = useLocale();
  const format = useFormat();
  const currencyLabel = useId();
  const price =
    product.prices.find((p) => p.money.currency === store.currency) ??
    product.prices[0];
  const subscription = product.kind === "subscription";

  // One reserved line under the button: progress, a problem, or the hint.
  let line: React.ReactNode = null;
  let lineTone: "neutral" | "pending" | "error" = "neutral";
  let lineIcon: React.ReactNode;
  if (store.status !== "idle") {
    lineTone = "pending";
    line = t(`status.${store.status}`);
  } else if (store.problem) {
    lineTone = "error";
    line =
      store.problem === "signedOut" ? (
        <span>
          {t("problem.signedOut")}{" "}
          <a
            className="underline underline-offset-4"
            href={signInPath("/catalog")}
          >
            {t("problem.signIn")}
          </a>
        </span>
      ) : store.problem === "slow" && store.orderId ? (
        <span>
          {t("problem.slow")}{" "}
          <Link
            className="underline underline-offset-4"
            href={`/orders/${store.orderId}`}
          >
            {t("problem.openOrder")}
          </Link>
        </span>
      ) : (
        t(`problem.${store.problem}`)
      );
  } else {
    lineIcon = <LockSimpleIcon />;
    line = t("secure");
  }

  return (
    <article
      className="card product-card"
      id={product.key}
      aria-labelledby={`${product.key}-title`}
    >
      <div className="product-top">
        <span className="status" data-tone="neutral">
          {subscription ? (
            <ArrowsClockwiseIcon weight="bold" aria-hidden="true" />
          ) : (
            <SealCheckIcon weight="bold" aria-hidden="true" />
          )}
          {subscription
            ? `${kinds("subscription")} · ${periodic(product.periodicity)}`
            : kinds(product.kind)}
        </span>
        {ownership && (
          <span className="status" data-tone="success">
            <CheckCircleIcon weight="fill" aria-hidden="true" />
            {t(ownership.kind)}
          </span>
        )}
      </div>
      <h3 id={`${product.key}-title`}>{pick(product.title, locale)}</h3>
      <p className="product-description">{pick(product.description, locale)}</p>
      <div className="product-buy">
        <div className="product-price-row">
          <p className="product-price">
            <strong className="nums">
              {price ? format.money(price.money) : "—"}
            </strong>
            <span>
              {subscription
                ? t("perPeriod", { period: periods(product.periodicity) })
                : t("oneTime")}
            </span>
          </p>
          {!ownership && product.prices.length > 1 && (
            <fieldset
              className="currency-switch"
              aria-labelledby={currencyLabel}
            >
              <legend id={currencyLabel} className="sr-only">
                {t("currency")}
              </legend>
              {product.prices.map(({ money }) => (
                <label key={money.currency}>
                  <input
                    type="radio"
                    name={`${product.key}-currency`}
                    value={money.currency}
                    checked={store.currency === money.currency}
                    disabled={store.busy}
                    onChange={() => store.selectCurrency(money.currency)}
                  />
                  {money.currency}
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <div className="product-action">
          {ownership ? (
            <Button asChild size="lg" variant="outline">
              <Link href={ownership.href}>
                {ownership.kind === "subscribed" ? t("manage") : t("viewOrder")}
              </Link>
            </Button>
          ) : (
            <Button
              size="lg"
              pending={store.busy}
              pendingLabel={t(
                `status.${store.status === "idle" ? "starting" : store.status}`,
              )}
              disabled={!salesOpen}
              onClick={() => void store.buy()}
            >
              {subscription ? t("subscribe") : t("buy")}
            </Button>
          )}
        </div>
        {!ownership && (
          <FormMessage
            tone={lineTone}
            icon={lineIcon}
            lines={2}
            aria-live="polite"
          >
            {line}
          </FormMessage>
        )}
      </div>
    </article>
  );
});
