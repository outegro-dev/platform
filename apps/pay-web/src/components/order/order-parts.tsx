"use client";

import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import {
  ArrowSquareOutIcon,
  ArrowUUpLeftIcon,
  CheckIcon,
  QuestionIcon,
  WifiSlashIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ServiceMark } from "@/components/service-mark";
import { pick } from "@/lib/i18n";
import { useFormat } from "@/lib/i18n-client";
import type { Localized, Order, Periodicity } from "@/lib/payments/model";
import type {
  AccessPhase,
  OrderPhase,
  PendingDetail,
  TimelineStep,
} from "@/lib/payments/status";

/*
 * Presentational pieces of the order page. They receive plain values from
 * the observers in order-view.tsx and never read a store themselves.
 */

export type HeroFoot =
  | "checking"
  | "retrying"
  | "offline"
  | "signed-out"
  | "gone"
  | "none";

type HeroProps = {
  outcome: OrderPhase;
  detail: PendingDetail;
  /** The buyer came back from Lava with result=failure|cancel. */
  leftPayment: boolean;
  timedOut: boolean;
  /** Settled while this page was open: play the settle-in motion. */
  animate: boolean;
  foot: HeroFoot;
  paymentUrl: string | null;
  product: string;
  serviceName: string | null;
  serviceUrl: string | null;
  accessUntil: string | null;
  accessForever: boolean;
  subscriptionId: string | null;
  signInHref: string;
  /** Where "try again" leads: the product in the catalog. */
  retryHref: string;
  onCheckAgain: () => void;
};

export function OrderHero(props: HeroProps) {
  const t = useTranslations("watch");
  const order = useTranslations("order");
  const format = useFormat();
  const service = props.serviceName ?? "outegro";
  let tone: "success" | "danger" | undefined;
  let mark: ReactNode = <Orb />;
  let title: string;
  let body: string;
  let actions: ReactNode = null;

  const payLink = props.paymentUrl ? (
    <a className="hero-aside-link" href={props.paymentUrl} rel="noopener">
      {order("notPaidYet")} {order("continuePayment")}
      <ArrowSquareOutIcon aria-hidden="true" />
    </a>
  ) : null;
  const checkAgain = (
    <Button size="lg" onClick={props.onCheckAgain}>
      {t("checkAgain")}
    </Button>
  );

  switch (props.outcome) {
    case "processing": {
      if (props.timedOut) {
        title = t("timedOutTitle");
        body = t("timedOutBody");
        actions = (
          <>
            {checkAgain}
            {payLink}
          </>
        );
        break;
      }
      // Lava said the buyer cancelled or the payment failed. Still only a
      // hint: the watch goes on and the server's answer wins.
      if (props.leftPayment && props.detail === "awaiting") {
        title = t("leftTitle");
        body = t("leftBody");
        actions = props.paymentUrl ? (
          <Button asChild size="lg">
            <a href={props.paymentUrl} rel="noopener">
              {order("continuePayment")}
              <ArrowSquareOutIcon aria-hidden="true" />
            </a>
          </Button>
        ) : null;
        break;
      }
      const copy = {
        preparing: ["preparingTitle", "preparingBody"],
        awaiting: ["processingTitle", "processingBody"],
        verifying: ["verifyingTitle", "verifyingBody"],
      } as const;
      const [titleKey, bodyKey] = copy[props.detail];
      title = t(titleKey);
      body = t(bodyKey);
      actions = payLink;
      break;
    }
    // Pending for long: an abandoned checkout, unless Lava confirms now.
    case "unpaid":
      title = t("unpaidTitle");
      body = t("unpaidBody");
      actions = props.paymentUrl ? (
        <Button asChild size="lg" variant="outline">
          <a href={props.paymentUrl} rel="noopener">
            {order("continuePayment")}
            <ArrowSquareOutIcon aria-hidden="true" />
          </a>
        </Button>
      ) : null;
      break;
    case "activating":
      title = t("activatingTitle", { service });
      body = props.timedOut
        ? t("timedOutActivatingBody")
        : t("activatingBody", { service });
      actions = props.timedOut ? checkAgain : null;
      break;
    case "paid":
      tone = "success";
      mark = (
        <Medallion
          tone="success"
          animate={props.animate}
          icon={<CheckIcon weight="bold" />}
        />
      );
      title = t("paidTitle", { service });
      body = props.accessUntil
        ? t("paidBodyUntil", {
            product: props.product,
            date: format.date(props.accessUntil),
          })
        : props.accessForever
          ? t("paidBodyForever", { product: props.product })
          : t("paidBodyGeneric");
      actions = (
        <>
          {props.serviceUrl && props.serviceName && (
            <Button asChild size="lg">
              <a href={props.serviceUrl}>
                {order("openService", { service: props.serviceName })}
                <ArrowSquareOutIcon aria-hidden="true" />
              </a>
            </Button>
          )}
          {props.subscriptionId && (
            <Button asChild size="lg" variant="outline">
              <Link href="/subscriptions">{order("manageSubscription")}</Link>
            </Button>
          )}
        </>
      );
      break;
    case "failed":
      tone = "danger";
      mark = (
        <Medallion
          tone="danger"
          animate={props.animate}
          icon={<XIcon weight="bold" />}
        />
      );
      title = t("failedTitle");
      body = t("failedBody");
      actions = (
        <Button asChild size="lg">
          <Link href={props.retryHref}>{t("failedAction")}</Link>
        </Button>
      );
      break;
    case "refunded":
      mark = (
        <Medallion
          tone="neutral"
          animate={props.animate}
          icon={<ArrowUUpLeftIcon weight="bold" />}
        />
      );
      title = t("refundedTitle");
      body = t("refundedBody");
      actions = (
        <Button asChild size="lg" variant="outline">
          <Link href="/orders">{order("back")}</Link>
        </Button>
      );
      break;
    default:
      mark = (
        <Medallion
          tone="neutral"
          animate={false}
          icon={<QuestionIcon weight="bold" />}
        />
      );
      title = t("unknownTitle");
      body = t("unknownBody");
  }

  return (
    <section
      className="hero-card"
      data-tone={tone}
      aria-labelledby="order-hero-title"
    >
      {mark}
      <div className="hero-copy">
        <div role="status" className="hero-text">
          <h2 id="order-hero-title">{title}</h2>
          <p>{body}</p>
        </div>
        {actions ? <div className="hero-actions">{actions}</div> : null}
      </div>
      <HeroFootLine foot={props.foot} signInHref={props.signInHref} />
    </section>
  );
}

function HeroFootLine({
  foot,
  signInHref,
}: {
  foot: HeroFoot;
  signInHref: string;
}) {
  const t = useTranslations("watch");
  const states = useTranslations("states");
  let content: ReactNode = null;
  let tone: "neutral" | "pending" | "error" = "neutral";
  let icon: ReactNode;
  switch (foot) {
    case "checking":
      icon = <span className="status-dot" />;
      content = t("checking");
      break;
    case "retrying":
      tone = "pending";
      content = t("retrying");
      break;
    case "offline":
      tone = "error";
      icon = <WifiSlashIcon />;
      content = t("offline");
      break;
    case "signed-out":
      tone = "error";
      content = (
        <span>
          {t("signedOut")}{" "}
          <a className="underline underline-offset-4" href={signInHref}>
            {states("signIn")}
          </a>
        </span>
      );
      break;
    case "gone":
      tone = "error";
      content = t("gone");
      break;
  }
  return (
    <FormMessage
      className="hero-foot"
      tone={tone}
      icon={icon}
      data-empty={content ? undefined : true}
      aria-live="polite"
    >
      {content}
    </FormMessage>
  );
}

/** Calm processing mark: a slowly turning silver orb with breathing rings. */
function Orb() {
  return (
    <span className="orb" aria-hidden="true">
      <span className="orb-ring" />
      <span className="orb-ring" />
      <span className="orb-core" />
    </span>
  );
}

function Medallion({
  tone,
  icon,
  animate,
}: {
  tone: "success" | "danger" | "neutral";
  icon: ReactNode;
  animate: boolean;
}) {
  return (
    <span
      className="medallion"
      data-tone={tone}
      data-animate={animate || undefined}
      aria-hidden="true"
    >
      <span className="medallion-core">{icon}</span>
    </span>
  );
}

export function OrderTimeline({ steps }: { steps: TimelineStep[] }) {
  const t = useTranslations("timeline");
  const format = useFormat();
  const word = {
    done: t("stepDone"),
    current: t("stepCurrent"),
    failed: t("stepFailed"),
    upcoming: t("stepUpcoming"),
  };
  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li key={step.key} className="timeline-step" data-state={step.state}>
          <span className="timeline-mark" aria-hidden="true">
            {step.state === "done" ? (
              <CheckIcon weight="bold" />
            ) : step.state === "failed" ? (
              <XIcon weight="bold" />
            ) : step.state === "current" ? (
              <span className="status-dot" />
            ) : null}
          </span>
          <span className="timeline-text">
            <span className="timeline-label">
              {t(`${step.key}.${step.variant}`)}
              <span className="sr-only">, {word[step.state]}</span>
            </span>
            <span className="timeline-time nums">
              {step.at ? (
                <time dateTime={step.at}>{format.dateTime(step.at)}</time>
              ) : null}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OrderBenefit({
  service,
  serviceName,
  serviceUrl,
  title,
  kind,
  periodicity,
  description,
  access,
  accessDate,
}: {
  service: string | null;
  serviceName: string | null;
  serviceUrl: string | null;
  title: string;
  kind: Order["kind"];
  periodicity: Periodicity | null;
  description: Localized | null;
  access: AccessPhase;
  accessDate: string | null;
}) {
  const t = useTranslations("order");
  const accessText = useTranslations("access");
  const kinds = useTranslations("kinds");
  const periodic = useTranslations("periodic");
  const locale = useLocale();
  const format = useFormat();
  const meta = [
    serviceName,
    kind === "subscription" && periodicity && periodicity !== "ONE_TIME"
      ? `${kinds("subscription")} · ${periodic(periodicity)}`
      : kinds(kind),
  ]
    .filter(Boolean)
    .join(" · ");
  const tone =
    access === "active-forever" || access === "active-until"
      ? "success"
      : access === "revoked" || access === "expired" || access === "none"
        ? "neutral"
        : "pending";
  return (
    <section
      className="card panel benefit-panel"
      aria-labelledby="order-benefit-title"
    >
      <h2 id="order-benefit-title" className="og-eyebrow">
        {t("benefit")}
      </h2>
      <div className="benefit">
        <ServiceMark service={service} size="lg" />
        <div className="benefit-body">
          <h3>{title}</h3>
          <p className="og-eyebrow">{meta}</p>
          <p>
            {description
              ? pick(description, locale)
              : t("benefitFallback", { service: serviceName ?? "outegro" })}
          </p>
          <div className="benefit-access">
            <span className="status" data-tone={tone}>
              {tone === "pending" ? (
                <span className="status-dot" aria-hidden="true" />
              ) : tone === "success" ? (
                <CheckIcon weight="bold" aria-hidden="true" />
              ) : null}
              {accessText(access, {
                date: accessDate ? format.date(accessDate) : "",
              })}
            </span>
            {serviceUrl && serviceName && (
              <a className="hero-aside-link" href={serviceUrl}>
                {t("openService", { service: serviceName })}
                <ArrowSquareOutIcon aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function OrderSummary({
  order,
  title,
  serviceName,
  periodicity,
}: {
  order: Order;
  title: string;
  serviceName: string | null;
  periodicity: Periodicity | null;
}) {
  const t = useTranslations("summary");
  const kinds = useTranslations("kinds");
  const periodic = useTranslations("periodic");
  const format = useFormat();
  const type =
    order.kind === "subscription" && periodicity && periodicity !== "ONE_TIME"
      ? `${kinds("subscription")} · ${periodic(periodicity)}`
      : kinds(order.kind);
  return (
    <section className="receipt" aria-labelledby="order-summary-title">
      <h2 id="order-summary-title" className="og-eyebrow">
        {t("title")}
      </h2>
      <dl className="receipt-rows">
        <div className="receipt-row" data-stacked>
          <dt>{t("number")}</dt>
          <dd className="mono">{order.id}</dd>
        </div>
        <div className="receipt-row">
          <dt>{t("product")}</dt>
          <dd>{title}</dd>
        </div>
        {serviceName && (
          <div className="receipt-row">
            <dt>{t("service")}</dt>
            <dd>{serviceName}</dd>
          </div>
        )}
        <div className="receipt-row">
          <dt>{t("type")}</dt>
          <dd>{type}</dd>
        </div>
        <div className="receipt-row">
          <dt>{t("created")}</dt>
          <dd className="nums">
            <time dateTime={order.createdAt}>
              {format.dateTime(order.createdAt)}
            </time>
          </dd>
        </div>
        <div className="receipt-row">
          <dt>{t("paid")}</dt>
          <dd className="nums">
            {order.paidAt ? (
              <time dateTime={order.paidAt}>
                {format.dateTime(order.paidAt)}
              </time>
            ) : (
              <span className="muted">{t("notPaid")}</span>
            )}
          </dd>
        </div>
        <div className="receipt-row">
          <dt>{t("provider")}</dt>
          <dd>{t("providerName")}</dd>
        </div>
      </dl>
      <hr className="receipt-rule" />
      <dl>
        <div className="receipt-total">
          <dt>{t("total")}</dt>
          <dd className="nums">{format.money(order.money, { exact: true })}</dd>
        </div>
      </dl>
      <p className="receipt-note">{t("note")}</p>
    </section>
  );
}
