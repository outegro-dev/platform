"use client";
// MobX observers read mutable stores during render; the React Compiler's
// memoization would hand back stale JSX, so this file opts out.
"use no memo";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import {
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { cancelSubscription } from "@/app/actions";
import { BusyButton } from "@/components/busy-button";
import { ServiceMark } from "@/components/service-mark";
import { SubscriptionStatusBadge } from "@/components/status-badge";
import { pick } from "@/lib/i18n";
import { useFormat, useServiceName } from "@/lib/i18n-client";
import type { Subscription } from "@/lib/payments/model";
import { graceDays, subscriptionNote } from "@/lib/payments/status";
import { signInPath } from "@/lib/sso";
import { SubscriptionContext, useSubscription } from "@/stores/contexts";
import { SubscriptionStore } from "@/stores/subscription-store";

type CardProps = {
  initial: Subscription;
  service: string | null;
};

/** One subscription: state, paid period, access, renewal and its cancel flow. */
export function SubscriptionCard({ initial, service }: CardProps) {
  const [store] = useState(
    () => new SubscriptionStore(initial, { cancel: cancelSubscription }),
  );
  return (
    <SubscriptionContext.Provider value={store}>
      <CardBody service={service} />
    </SubscriptionContext.Provider>
  );
}

const CardBody = observer(function CardBody({
  service,
}: Omit<CardProps, "initial">) {
  const store = useSubscription();
  const sub = store.subscription;
  const t = useTranslations("subscriptions");
  const periods = useTranslations("periods");
  const locale = useLocale();
  const format = useFormat();
  const nameOf = useServiceName();
  const noteRef = useRef<HTMLParagraphElement>(null);

  const title = sub.title ? pick(sub.title, locale) : sub.productKey;
  const price = t("perPeriod", {
    price: format.money(sub.money),
    period: periods(sub.periodicity),
  });
  const grace = graceDays(sub);
  const dates = {
    paidUntil: format.date(sub.paidUntil),
    accessUntil: format.date(sub.accessUntil),
  };
  const past = sub.state === "expired";
  const renewal =
    sub.state === "cancel_requested"
      ? t("renewalPending")
      : past
        ? t("ended")
        : sub.autoRenew
          ? t("renewalOn")
          : t("renewalOff");

  return (
    <article
      className="card sub-card"
      data-past={past || undefined}
      aria-labelledby={`sub-${sub.id}`}
    >
      <div className="sub-head">
        <ServiceMark service={service} />
        <div className="sub-name">
          <h3 id={`sub-${sub.id}`}>{title}</h3>
          <p className="og-eyebrow">
            {service ? `${nameOf(service)} · ` : ""}
            {price}
          </p>
        </div>
        <SubscriptionStatusBadge state={sub.state} />
      </div>
      <dl className="sub-facts">
        <div>
          <dt>{t("paidUntil")}</dt>
          <dd className="nums">
            <time dateTime={sub.paidUntil}>{dates.paidUntil}</time>
          </dd>
        </div>
        <div>
          <dt>{t("accessUntil")}</dt>
          <dd className="nums">
            <time dateTime={sub.accessUntil}>{dates.accessUntil}</time>
            {grace > 0 && (
              <span className="fact-note">{t("grace", { days: grace })}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("renewal")}</dt>
          <dd>{renewal}</dd>
        </div>
      </dl>
      <div className="sub-foot">
        <p className="sub-note" ref={noteRef} tabIndex={-1} aria-live="polite">
          {store.result ? (
            <span className="done">
              <CheckCircleIcon weight="fill" aria-hidden="true" />
              {store.result === "unchanged"
                ? t("done.unchanged")
                : t(`done.${store.result}`, dates)}
            </span>
          ) : (
            <span className="muted">
              {t(`note.${subscriptionNote(sub)}`, dates)}
            </span>
          )}
        </p>
        <div className="sub-actions">
          <Button asChild variant="ghost">
            <Link href={`/orders/${sub.orderId}`}>{t("order")}</Link>
          </Button>
          {store.canCancel && (
            <CancelDialog title={title} dates={dates} noteRef={noteRef} />
          )}
        </div>
      </div>
    </article>
  );
});

const CancelDialog = observer(function CancelDialog({
  title,
  dates,
  noteRef,
}: {
  title: string;
  dates: { paidUntil: string; accessUntil: string };
  noteRef: React.RefObject<HTMLParagraphElement | null>;
}) {
  const store = useSubscription();
  const t = useTranslations("cancel");
  const subs = useTranslations("subscriptions");
  const states = useTranslations("states");
  const problem = store.problem;
  return (
    <Dialog open={store.dialogOpen} onOpenChange={store.setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t("confirm")}</Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("close")}
        showCloseButton={!store.pending}
        onEscapeKeyDown={(event) => store.pending && event.preventDefault()}
        onPointerDownOutside={(event) =>
          store.pending && event.preventDefault()
        }
        onCloseAutoFocus={(event) => {
          // The cancel button is gone after success: land on the result.
          if (store.result) {
            event.preventDefault();
            noteRef.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("body", { product: title, ...dates })}
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          <dl className="dialog-facts">
            <div>
              <dt>{subs("paidUntil")}</dt>
              <dd className="nums">{dates.paidUntil}</dd>
            </div>
            <div>
              <dt>{subs("accessUntil")}</dt>
              <dd className="nums">{dates.accessUntil}</dd>
            </div>
          </dl>
          <p>{t("notRefund")}</p>
          <p
            className="live-line"
            data-tone={problem ? "danger" : undefined}
            aria-live="polite"
          >
            {problem && <WarningCircleIcon aria-hidden="true" />}
            {problem === "signed-out" ? (
              <span>
                {t("signedOut")}{" "}
                <a
                  className="underline underline-offset-4"
                  href={signInPath("/subscriptions")}
                >
                  {states("signIn")}
                </a>
              </span>
            ) : problem ? (
              t(problem)
            ) : null}
          </p>
        </div>
        <div className="dialog-actions">
          <Button
            variant="ghost"
            size="lg"
            onClick={() => store.setDialogOpen(false)}
            disabled={store.pending}
          >
            {t("keep")}
          </Button>
          <BusyButton
            variant="destructive"
            size="lg"
            busy={store.pending}
            busyLabel={t("confirming")}
            onClick={() => void store.confirm()}
          >
            {t("confirm")}
          </BusyButton>
        </div>
      </DialogContent>
    </Dialog>
  );
});
