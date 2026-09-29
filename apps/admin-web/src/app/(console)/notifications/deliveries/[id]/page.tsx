import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { retryDelivery } from "@/app/(console)/notifications/actions";
import { ActionDialog } from "@/components/ui/action-dialog";
import { CopyText } from "@/components/ui/copy-text";
import { JsonView, Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import type { Params } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.delivery");
  return { title: t("title") };
}

export default async function DeliveryPage({
  params,
}: {
  params: Params<"id">;
}) {
  const access = await pageAccess("notifications.read");
  if (!access.ok) return access.element;
  const { id } = await params;
  const t = await getTranslations("notifications.delivery");
  const label = await getLabels();
  const f = await getFormatter();
  const back = (
    <Link
      href="/notifications/deliveries"
      className="panel-link"
      style={{ margin: 0 }}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {t("back")}
    </Link>
  );
  const result = await load(() => services().notifications.delivery(id));
  if (!result.ok) {
    return (
      <Panel action={back}>
        <FailureState failure={result} what={t("what")} />
      </Panel>
    );
  }
  const delivery = result.data;
  const expired = Date.parse(delivery.intent.expiresAt) <= f.now;
  const whyNot = delivery.retryable
    ? null
    : delivery.category === "auth"
      ? t("notRetryablePrivate")
      : expired
        ? t("notRetryableExpired")
        : t("notRetryableState", { state: label("delivery", delivery.state) });
  const canRetry = access.granted.has("notifications.retry");

  return (
    <>
      <Panel
        id="delivery"
        kicker={label("channel", delivery.channel)}
        title={delivery.title}
        action={back}
      >
        <div className="row-gap">
          <Status tone={toneOf("delivery", delivery.state)}>
            {label("delivery", delivery.state)}
          </Status>
          <span className="chip" data-tone="muted">
            {label("category", delivery.category)}
          </span>
          <span className="small mono muted">{delivery.templateKey}</span>
        </div>
        {delivery.lastError && (
          <p className="notice" data-tone="bad">
            <WarningCircleIcon aria-hidden="true" />
            <span>
              <strong>{t("lastError")}</strong> {delivery.lastError}
            </span>
          </p>
        )}
        <Facts
          items={[
            {
              label: t("id"),
              value: (
                <CopyText value={delivery.id} display={shortId(delivery.id)} />
              ),
            },
            {
              label: t("recipient"),
              value: (
                <Link href={`/users/${delivery.userId}`} className="link mono">
                  {shortId(delivery.userId)}
                </Link>
              ),
            },
            {
              label: t("attempts"),
              value: <span className="num">{delivery.attempts}</span>,
            },
            { label: t("created"), value: <Time iso={delivery.createdAt} /> },
            { label: t("updated"), value: <Time iso={delivery.updatedAt} /> },
            {
              label: t("nextAttempt"),
              value:
                delivery.state === "pending" ||
                delivery.state === "retry_wait" ? (
                  <Time iso={delivery.nextAttemptAt} />
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              label: t("providerId"),
              value: delivery.providerMessageId ? (
                <CopyText
                  value={delivery.providerMessageId}
                  display={shortId(delivery.providerMessageId)}
                />
              ) : (
                <span className="muted">—</span>
              ),
            },
            {
              label: t("expires"),
              value: (
                <span className="row-gap">
                  <Time iso={delivery.intent.expiresAt} />
                  {expired && (
                    <Status tone="neutral">{t("expiredBadge")}</Status>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Panel>

      <div className="grid-main">
        <Panel id="retry" title={t("retryTitle")} note={t("retryNote")}>
          {delivery.retryable ? (
            canRetry ? (
              <div className="stack-sm">
                <p className="state-body">
                  {delivery.state === "unknown"
                    ? t("retryUnknownBody")
                    : t("retryBody")}
                </p>
                <div className="row-gap">
                  <ActionDialog
                    action={retryDelivery}
                    triggerLabel={t("retry")}
                    triggerVariant="primary"
                    triggerIcon={<ArrowClockwiseIcon aria-hidden="true" />}
                    title={t("retryDialogTitle")}
                    description={t("retryDialogDescription", {
                      title: delivery.title,
                    })}
                    consequences={[
                      t("retryEffect"),
                      t("retrySchedule"),
                      ...(delivery.state === "unknown"
                        ? [t("retryUnknownRisk")]
                        : []),
                      t("audited"),
                    ]}
                    confirmLabel={t("retryConfirm")}
                    hidden={{ deliveryId: delivery.id }}
                    acknowledge={
                      delivery.state === "unknown"
                        ? { name: "confirmUnknown", label: t("confirmUnknown") }
                        : undefined
                    }
                  />
                </div>
              </div>
            ) : (
              <p className="state-body">{t("retryNoPermission")}</p>
            )
          ) : (
            <p className="state-body">{whyNot}</p>
          )}
        </Panel>
        <Panel id="recipient" title={t("recipientTitle")}>
          {delivery.recipient ? (
            <Facts
              items={[
                {
                  label: t("email"),
                  value: (
                    <span className="mono">
                      {delivery.recipient.email ?? "—"}
                    </span>
                  ),
                },
                {
                  label: t("verified"),
                  value: delivery.recipient.emailVerified ? t("yes") : t("no"),
                },
                {
                  label: t("telegram"),
                  value: delivery.recipient.telegramLinked
                    ? t("linked")
                    : t("notLinked"),
                },
                {
                  label: t("language"),
                  value: label("locale", delivery.recipient.locale),
                },
              ]}
            />
          ) : (
            <p className="state-body">{t("noRecipient")}</p>
          )}
        </Panel>
      </div>

      <Panel id="intent" title={t("intentTitle")} note={t("intentNote")}>
        <Facts
          items={[
            {
              label: t("producer"),
              value: <span className="mono">{delivery.intent.producer}</span>,
            },
            {
              label: t("sourceEvent"),
              value: (
                <CopyText
                  value={delivery.intent.sourceEventId}
                  display={shortId(delivery.intent.sourceEventId)}
                />
              ),
            },
            {
              label: t("language"),
              value: delivery.intent.locale
                ? label("locale", delivery.intent.locale)
                : "—",
            },
            {
              label: t("intentCreated"),
              value: <Time iso={delivery.intent.createdAt} />,
            },
          ]}
        />
        <JsonView value={delivery.intent.data} label={t("data")} />
      </Panel>
    </>
  );
}
