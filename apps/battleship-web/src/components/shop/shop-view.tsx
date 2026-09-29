"use client";

import {
  battleshipFeatures,
  type CosmeticSlot,
  type Cosmetics,
  cosmeticUnlocked,
} from "@outegro/contracts/battleship";
import { Button } from "@outegro/ui/button";
import {
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CrownSimpleIcon,
  HourglassIcon,
  LockSimpleIcon,
  SealCheckIcon,
  SignInIcon,
  SparkleIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ShopStore } from "@/game/stores/shop-store";
import {
  type Catalog,
  type CatalogProduct,
  type CheckoutResult,
  type Currency,
  defaultCurrency,
} from "@/lib/catalog";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { signInHref } from "@/lib/routes";
import { DemoBoard } from "../board/demo-board";
import { CellMark } from "../board/marks";
import { ShipArt } from "../board/ship";
import { StableLabel } from "../home/modes";
import { useRoot } from "../providers";

const PRODUCTS = [
  {
    feature: battleshipFeatures.premium,
    key: "premium",
    features: ["bots", "stats", "skins", "badge"],
  },
  {
    feature: battleshipFeatures.silverFleet,
    key: "silver",
    features: ["ships", "shards", "night"],
  },
] as const;

const Banner = observer(function Banner({ shop }: { shop: ShopStore }) {
  const t = useTranslations("shop");
  const product = shop.awaiting ? shop.productFor(shop.awaiting) : null;
  const name =
    product?.title ??
    (shop.awaiting === battleshipFeatures.premium
      ? t("premium.title")
      : t("silver.title"));
  let content: React.ReactNode = null;
  let tone: "info" | "success" | "error" = "info";
  if (shop.phase === "processing") {
    content = (
      <>
        <span className="shop-banner-icon" aria-hidden="true">
          <span className="spinner" />
        </span>
        <span className="shop-banner-text">
          <strong>{t("processing")}</strong>
          <span>{t("processingBody")}</span>
        </span>
      </>
    );
  } else if (shop.phase === "success") {
    tone = "success";
    content = (
      <>
        <span className="shop-banner-icon" aria-hidden="true">
          <SealCheckIcon weight="fill" />
        </span>
        <span className="shop-banner-text">
          <strong>{t("success")}</strong>
          <span>{t("successBody", { product: name })}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={shop.dismiss}
          aria-label={t("dismiss")}
        >
          <XIcon />
        </Button>
      </>
    );
  } else if (shop.phase === "slow") {
    content = (
      <>
        <span className="shop-banner-icon" aria-hidden="true">
          <HourglassIcon />
        </span>
        <span className="shop-banner-text">
          <strong>{t("slow")}</strong>
          <span>{t("slowBody")}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={shop.dismiss}
          aria-label={t("dismiss")}
        >
          <XIcon />
        </Button>
      </>
    );
  } else if (
    shop.phase === "preparing" ||
    shop.phase === "starting" ||
    shop.phase === "redirecting"
  ) {
    content = (
      <>
        <span className="shop-banner-icon" aria-hidden="true">
          <span className="spinner" />
        </span>
        <span className="shop-banner-text">
          <strong>
            {shop.phase === "redirecting"
              ? t("redirecting")
              : shop.phase === "preparing"
                ? t("preparing")
                : t("starting")}
          </strong>
        </span>
      </>
    );
  } else if (shop.phase === "cancelled" || shop.phase === "failed") {
    tone = shop.phase === "failed" ? "error" : "info";
    content = (
      <>
        <span className="shop-banner-icon" aria-hidden="true">
          {shop.phase === "failed" ? <WarningCircleIcon /> : <XCircleIcon />}
        </span>
        <span className="shop-banner-text">
          <strong>{t(shop.phase)}</strong>
          <span>{t(`${shop.phase}Body`)}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={shop.dismiss}
          aria-label={t("dismiss")}
        >
          <XIcon />
        </Button>
      </>
    );
  } else if (shop.error) {
    tone = "error";
    content = (
      <>
        <span className="shop-banner-icon" aria-hidden="true">
          <WarningCircleIcon />
        </span>
        <span className="shop-banner-text">
          <strong>{t(`errors.${shop.error}`)}</strong>
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={shop.dismiss}
          aria-label={t("dismiss")}
        >
          <XIcon />
        </Button>
      </>
    );
  }
  if (!content) return null;
  return (
    <div
      className="shop-banner og-glass"
      data-tone={tone}
      role="status"
      aria-live="polite"
      data-testid="shop-banner"
    >
      {content}
    </div>
  );
});

const ProductCard = observer(function ProductCard({
  shop,
  spec,
}: {
  shop: ShopStore;
  spec: (typeof PRODUCTS)[number];
}) {
  const { session } = useRoot();
  const t = useTranslations("shop");
  const locale = useLocale();
  const product: CatalogProduct | null = shop.productFor(spec.feature);
  const price = product ? shop.priceOf(product) : null;
  const premium = spec.key === "premium";
  const owned = shop.owns(spec.feature);
  const catalog = shop.catalog;
  const buying = shop.buying === product?.key;
  const until = premium ? session.profile?.premiumUntil : null;

  let action: React.ReactNode;
  if (owned) {
    action = (
      <span className="owned-tag" data-testid={`owned-${spec.key}`}>
        <CheckCircleIcon weight="fill" aria-hidden="true" />
        {premium
          ? until
            ? t("activeUntil", { date: formatDate(until, locale) })
            : t("active")
          : t("owned")}
      </span>
    );
  } else if (catalog.status === "unconfigured" || !product) {
    action = (
      <span className="soon-tag">
        <ClockIcon aria-hidden="true" />
        {t("comingSoon")}
      </span>
    );
  } else if (!catalog.checkoutEnabled) {
    action = (
      <span className="soon-tag" data-testid={`soon-${spec.key}`}>
        <ClockIcon aria-hidden="true" />
        {t("openSoon")}
      </span>
    );
  } else if (!session.signedIn) {
    action = (
      <Button asChild size="lg" variant="primary">
        <a href={signInHref("/shop")}>
          <SignInIcon />
          {t("signInToBuy")}
        </a>
      </Button>
    );
  } else {
    action = (
      <Button
        size="lg"
        variant="primary"
        onClick={() => void shop.buy(product)}
        disabled={shop.busy}
        data-testid={`buy-${spec.key}`}
      >
        <StableLabel
          active={buying}
          on={t("starting")}
          off={premium ? t("subscribe") : t("buy")}
        />
      </Button>
    );
  }

  return (
    <article
      className="card product"
      data-featured={premium || undefined}
      data-tone={premium ? "dark" : undefined}
      data-testid={`product-${spec.key}`}
    >
      <div className="product-preview">
        <DemoBoard
          label={t("preview")}
          size="lg"
          theme={premium ? "day" : "night-sea"}
          skin="silver"
          effect={premium ? "flame" : "shards"}
        />
      </div>
      <div className="stack-sm">
        <p className="product-tagline">{t(`${spec.key}.tagline`)}</p>
        <h2>{product?.title ?? t(`${spec.key}.title`)}</h2>
        {product?.description ? <p>{product.description}</p> : null}
      </div>
      <ul className="product-features">
        {spec.features.map((feature) => (
          <li key={feature}>
            {premium ? (
              <CrownSimpleIcon weight="fill" aria-hidden="true" />
            ) : (
              <SparkleIcon weight="fill" aria-hidden="true" />
            )}
            {t(`${spec.key}.features.${feature}`)}
          </li>
        ))}
      </ul>
      <div className="product-buy">
        <p className="price" data-testid={`price-${spec.key}`}>
          {price ? (
            <>
              {formatMoney(price.money, locale)}
              <small>
                {product?.periodicity === "MONTHLY" ? t("perMonth") : t("once")}
              </small>
            </>
          ) : (
            <small>{" "}</small>
          )}
        </p>
        {action}
      </div>
    </article>
  );
});

const slots: { slot: CosmeticSlot; items: string[] }[] = [
  { slot: "ships", items: ["classic", "silver"] },
  { slot: "hitEffect", items: ["flame", "shards"] },
  { slot: "theme", items: ["day", "night-sea"] },
];

function Swatch({ slot, item }: { slot: CosmeticSlot; item: string }) {
  if (slot === "ships") {
    return (
      <span className="cosmetic-swatch" aria-hidden="true">
        <ShipArt length={3} skin={item as "classic" | "silver"} />
      </span>
    );
  }
  if (slot === "hitEffect") {
    return (
      <span className="cosmetic-swatch cosmetic-swatch-mark" aria-hidden="true">
        <CellMark x={0} y={0} kind="hit" effect={item as "flame" | "shards"} />
      </span>
    );
  }
  return (
    <span
      className="cosmetic-swatch cosmetic-swatch-sea"
      data-sea={item === "night-sea" ? "night" : undefined}
      aria-hidden="true"
    />
  );
}

const CosmeticsPicker = observer(function CosmeticsPicker({
  shop,
}: {
  shop: ShopStore;
}) {
  const { session } = useRoot();
  const t = useTranslations("shop");
  const equipped = session.equipped;
  const effective = session.cosmetics;
  const features = session.features;
  return (
    <section className="cosmetics-section" aria-labelledby="cosmetics-title">
      <div className="section-head">
        <div className="stack-sm">
          <h2 id="cosmetics-title" className="section-title">
            {t("cosmetics")}
          </h2>
          <p className="muted">{t("cosmeticsLead")}</p>
        </div>
      </div>
      <div className="cosmetics">
        {slots.map(({ slot, items }) => (
          <div key={slot} className="card cosmetic-slot">
            <h3 id={`slot-${slot}`}>{t(`slots.${slot}`)}</h3>
            <fieldset className="cosmetic-options">
              <legend className="sr-only">{t(`slots.${slot}`)}</legend>
              {items.map((item) => {
                const unlocked = cosmeticUnlocked(
                  slot,
                  item as Cosmetics[typeof slot],
                  features,
                );
                const active = effective[slot] === item;
                const chosen = equipped[slot] === item;
                return (
                  <label key={item} className="cosmetic choice-tile">
                    <input
                      type="radio"
                      name={`cosmetic-${slot}`}
                      value={item}
                      checked={active}
                      disabled={
                        !session.signedIn ||
                        !unlocked ||
                        shop.equipping !== null
                      }
                      data-testid={`cosmetic-${slot}-${item}`}
                      onChange={() => {
                        if (!chosen || !active)
                          void shop.equip(slot, item as Cosmetics[typeof slot]);
                      }}
                    />
                    <Swatch slot={slot} item={item} />
                    <span className="cosmetic-label">
                      {t(`items.${item}`)}
                      <small>
                        {!unlocked ? (
                          <>
                            <LockSimpleIcon aria-hidden="true" />
                            {t("locked")}
                          </>
                        ) : active ? (
                          <>
                            <CheckIcon aria-hidden="true" />
                            {t("equipped")}
                          </>
                        ) : null}
                      </small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </div>
        ))}
      </div>
      <p
        className="status-line"
        role="status"
        data-tone={shop.equipError ? "error" : undefined}
      >
        {shop.equipError ? t(`equipErrors.${shop.equipError}`) : null}
      </p>
    </section>
  );
});

const CurrencySwitch = observer(function CurrencySwitch({
  shop,
}: {
  shop: ShopStore;
}) {
  const t = useTranslations("shop");
  if (shop.catalog.status !== "ok" || shop.currencies.length < 2) return null;
  return (
    <fieldset className="segmented currency-switch">
      <legend className="sr-only">{t("currency")}</legend>
      {shop.currencies.map((currency: Currency) => (
        <label key={currency} className="segment choice-tile">
          <input
            type="radio"
            name="currency"
            value={currency}
            checked={shop.currency === currency}
            onChange={() => shop.setCurrency(currency)}
            data-testid={`currency-${currency}`}
          />
          {currency}
        </label>
      ))}
    </fieldset>
  );
});

/** Products, purchases and cosmetics, with every payment state spelled out. */
export const ShopView = observer(function ShopView({
  catalog,
  returned,
}: {
  catalog: Catalog;
  returned: { orderId: string; result: CheckoutResult | null } | null;
}) {
  const root = useRoot();
  const locale = useLocale();
  const t = useTranslations("shop");
  const [shop] = useState(() =>
    root.createShop({ catalog, currency: defaultCurrency(locale), returned }),
  );
  const orderId = returned?.orderId ?? null;
  const result = returned?.result ?? null;

  useEffect(() => {
    if (orderId) shop.returnFromCheckout(orderId, result);
    return () => shop.dispose();
  }, [shop, orderId, result]);

  useEffect(() => {
    shop.setCatalog(catalog);
  }, [shop, catalog]);

  return (
    <>
      <Banner shop={shop} />
      <div className="shop-bar">
        {catalog.status === "unconfigured" ? (
          <p className="status-line" data-testid="shop-coming-soon">
            <ClockIcon aria-hidden="true" />
            {t("comingSoonBody")}
          </p>
        ) : catalog.status === "unavailable" ? (
          <p className="status-line" data-tone="error">
            <WarningCircleIcon aria-hidden="true" />
            {t("unavailable")}
          </p>
        ) : !catalog.checkoutEnabled ? (
          <p className="status-line">
            <ClockIcon aria-hidden="true" />
            {t("openSoonBody")}
          </p>
        ) : (
          <p className="status-line" />
        )}
        <CurrencySwitch shop={shop} />
      </div>
      <div className="products">
        {PRODUCTS.map((spec) => (
          <ProductCard key={spec.key} shop={shop} spec={spec} />
        ))}
      </div>
      <CosmeticsPicker shop={shop} />
    </>
  );
});
