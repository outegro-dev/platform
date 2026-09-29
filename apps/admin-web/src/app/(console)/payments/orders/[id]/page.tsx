import {
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  ProhibitIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  cancelSubscription,
  requestRefund,
} from "@/app/(console)/payments/actions";
import { revokeAccess } from "@/app/(console)/users/actions";
import { ActionDialog } from "@/components/ui/action-dialog";
import { CopyText } from "@/components/ui/copy-text";
import { DataTable, Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { cancellableStates } from "@/lib/adapters/payments";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { orderTimeline } from "@/lib/order-timeline";
import type { Params } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.order");
  return { title: t("title") };
}

/** Which label list names the state of each timeline entry. */
const stateKind: Record<string, string> = {
  attemptResolved: "attempt",
  event: "event",
  payment: "payment",
  subscription: "subscription",
  grant: "grantState",
  refund: "refund",
};

/** Everything around one order, and the story of how it got here. */
export default async function OrderPage({ params }: { params: Params<"id"> }) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const { id } = await params;
  const t = await getTranslations("payments.order");
  const label = await getLabels();
  const f = await getFormatter();
  const back = (
    <Link href="/payments/orders" className="panel-link" style={{ margin: 0 }}>
      <ArrowLeftIcon aria-hidden="true" />
      {t("back")}
    </Link>
  );
  const result = await load(() => services().payments.order(id));
  if (!result.ok) {
    return (
      <Panel
        action={back}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const detail = result.data;
  const { order, subscription } = detail;
  const lang = f.locale === "ru" ? "ru" : "en";
  const timeline = orderTimeline(detail);
  const { granted } = access;

  return (
    <>
      <Panel
        id="order"
        kicker={t("kicker")}
        title={order.title[lang]}
        action={back}
      >
        <div className="row-gap">
          <Status tone={toneOf("order", order.status)}>
            {label("order", order.status)}
          </Status>
          <span className="stat-value" data-size="sm">
            {f.money(order.money)}
          </span>
          <span className="chip" data-tone="muted">
            {label("productKind", order.kind)}
          </span>
        </div>
        <Facts
          items={[
            {
              label: t("id"),
              value: <CopyText value={order.id} display={shortId(order.id)} />,
            },
            {
              label: t("buyer"),
              value: (
                <Link href={`/users/${order.userId}`} className="link mono">
                  {shortId(order.userId)}
                </Link>
              ),
            },
            {
              label: t("product"),
              value: <span className="mono">{order.productKey}</span>,
            },
            {
              label: t("priceVersion"),
              value: <span className="mono">v{order.priceVersion}</span>,
            },
            { label: t("created"), value: <Time iso={order.createdAt} /> },
            { label: t("paid"), value: <Time iso={order.paidAt} /> },
            {
              label: t("correlation"),
              value: order.correlationId ? (
                <CopyText
                  value={order.correlationId}
                  display={shortId(order.correlationId)}
                />
              ) : (
                "—"
              ),
            },
            {
              label: t("access"),
              value: order.access ? (
                <Status tone={toneOf("grant", order.access.state)}>
                  {label("grantState", order.access.state)}
                </Status>
              ) : (
                <span className="muted">{t("noAccess")}</span>
              ),
            },
          ]}
        />
      </Panel>

      <div className="grid-main">
        <Panel id="timeline" title={t("timeline")} note={t("timelineNote")}>
          <ol className="timeline">
            {timeline.map((item) => (
              <li key={item.key} className="timeline-item">
                <span
                  className="timeline-dot"
                  data-tone={item.tone}
                  aria-hidden="true"
                />
                <div className="timeline-body">
                  <span className="timeline-title">
                    {t(`story.${item.kind}`, {
                      ...item.values,
                      status: item.values.status
                        ? label("order", item.values.status)
                        : "",
                      state: item.values.state
                        ? label(
                            stateKind[item.kind] ?? item.kind,
                            item.values.state,
                          )
                        : "",
                      action: item.values.action
                        ? label("action", item.values.action)
                        : "",
                      kind: item.values.kind
                        ? label(
                            item.kind === "refund"
                              ? "refundKind"
                              : "paymentKind",
                            item.values.kind,
                          )
                        : "",
                    })}
                    {item.kind === "event" && item.values.status && (
                      <Status tone={item.tone}>
                        {label("event", item.values.status)}
                      </Status>
                    )}
                  </span>
                  <span className="timeline-meta">
                    <Time iso={item.at} />
                    {item.also && (
                      <>
                        {" · "}
                        {t(`also.${item.also.label}`)}{" "}
                        <Time iso={item.also.at} />
                      </>
                    )}
                  </span>
                  {item.detail && (
                    <span className="timeline-meta">“{item.detail}”</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="stack">
          <Panel id="attempt" title={t("attempt")}>
            {detail.attempt ? (
              <Facts
                items={[
                  {
                    label: t("attemptState"),
                    value: (
                      <Status tone={toneOf("attempt", detail.attempt.state)}>
                        {label("attempt", detail.attempt.state)}
                      </Status>
                    ),
                  },
                  {
                    label: t("invoice"),
                    value: detail.attempt.providerInvoiceId ? (
                      <CopyText
                        value={detail.attempt.providerInvoiceId}
                        display={shortId(detail.attempt.providerInvoiceId)}
                      />
                    ) : (
                      "—"
                    ),
                  },
                  {
                    label: t("checks"),
                    value: <span className="num">{detail.attempt.checks}</span>,
                  },
                  {
                    label: t("requested"),
                    value: <Time iso={detail.attempt.requestedAt} />,
                  },
                ]}
              />
            ) : (
              <p className="small muted">{t("noAttempt")}</p>
            )}
            {detail.attempt?.failureReason && (
              <p className="small" style={{ color: "var(--destructive)" }}>
                {detail.attempt.failureReason}
              </p>
            )}
          </Panel>

          <Panel id="subscription" title={t("subscription")}>
            {subscription ? (
              <>
                <Facts
                  items={[
                    {
                      label: t("subscriptionState"),
                      value: (
                        <Status
                          tone={toneOf("subscription", subscription.state)}
                        >
                          {label("subscription", subscription.state)}
                        </Status>
                      ),
                    },
                    {
                      label: t("paidUntil"),
                      value: (
                        <Time iso={subscription.paidUntil} format="date" />
                      ),
                    },
                    {
                      label: t("accessUntil"),
                      value: (
                        <Time iso={subscription.accessUntil} format="date" />
                      ),
                    },
                    {
                      label: t("renews"),
                      value: subscription.autoRenew ? t("yes") : t("no"),
                    },
                  ]}
                />
                {granted.has("subscriptions.cancel") &&
                  (cancellableStates as readonly string[]).includes(
                    subscription.state,
                  ) && (
                    <div className="row-gap">
                      <ActionDialog
                        action={cancelSubscription}
                        triggerLabel={t("cancel")}
                        triggerIcon={<ProhibitIcon aria-hidden="true" />}
                        title={t("cancelTitle")}
                        description={t("cancelDescription", {
                          until: f.date(subscription.accessUntil),
                        })}
                        consequences={[
                          t("cancelEffect"),
                          t("cancelKeeps"),
                          t("cancelNoRefund"),
                          t("audited"),
                        ]}
                        confirmLabel={t("cancelConfirm")}
                        destructive
                        hidden={{ subscriptionId: subscription.id }}
                      />
                    </div>
                  )}
              </>
            ) : (
              <p className="small muted">{t("noSubscription")}</p>
            )}
          </Panel>

          <Panel id="grants" title={t("grants")}>
            {detail.grants.length === 0 ? (
              <p className="small muted">{t("noGrants")}</p>
            ) : (
              <ul className="stack-sm">
                {detail.grants.map((grant) => (
                  <li
                    key={grant.id}
                    className="row-gap"
                    style={{ justifyContent: "space-between" }}
                  >
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <span className="mono small">
                        {grant.service}/{grant.feature}
                      </span>
                      <span className="small muted">
                        {grant.validUntil ? (
                          <>
                            {t("until")}{" "}
                            <Time iso={grant.validUntil} format="date" />
                          </>
                        ) : (
                          t("forever")
                        )}
                      </span>
                    </span>
                    <span className="row-gap">
                      <Status tone={toneOf("grant", grant.state)}>
                        {label("grantState", grant.state)}
                      </Status>
                      {granted.has("grants.assign") &&
                        grant.state === "active" && (
                          <ActionDialog
                            action={revokeAccess}
                            triggerLabel={t("revokeGrant")}
                            triggerVariant="ghost"
                            triggerIcon={<XCircleIcon aria-hidden="true" />}
                            title={t("revokeGrantTitle")}
                            description={t("revokeGrantDescription", {
                              feature: grant.feature,
                            })}
                            consequences={[
                              t("revokeGrantEffect"),
                              t("revokeGrantOthers"),
                              t("audited"),
                            ]}
                            confirmLabel={t("revokeGrantConfirm")}
                            destructive
                            hidden={{ grantId: grant.id }}
                          />
                        )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel flush id="payments" title={t("payments")}>
        {detail.payments.length === 0 ? (
          <EmptyState size="sm" title={t("noPayments")} />
        ) : (
          <DataTable label={t("payments")}>
            <thead>
              <tr>
                <th scope="col">{t("colPayment")}</th>
                <th scope="col" className="num">
                  {t("colAmount")}
                </th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colPaidAt")}</th>
                <th scope="col">{t("colRecorded")}</th>
                {granted.has("refunds.request") && (
                  <th scope="col">
                    <span className="sr-only">{t("colActions")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((payment) => (
                <tr key={payment.id}>
                  <td data-primary="">
                    <span className="cell-main">
                      {label("paymentKind", payment.kind)}
                    </span>
                    <span className="cell-sub mono">
                      {payment.providerContractId ?? shortId(payment.id)}
                    </span>
                  </td>
                  <td data-label={t("colAmount")} className="num nowrap">
                    {f.money(payment.money)}
                  </td>
                  <td data-label={t("colState")}>
                    <Status tone={toneOf("payment", payment.state)}>
                      {label("payment", payment.state)}
                    </Status>
                  </td>
                  <td data-label={t("colPaidAt")}>
                    <Time iso={payment.paidAt} />
                  </td>
                  <td data-label={t("colRecorded")}>
                    <Time iso={payment.confirmedAt} />
                  </td>
                  {granted.has("refunds.request") && (
                    <td data-label={t("colActions")} className="num">
                      {payment.state === "confirmed" && (
                        <ActionDialog
                          action={requestRefund}
                          triggerLabel={t("refund")}
                          triggerVariant="ghost"
                          triggerIcon={<ArrowUUpLeftIcon aria-hidden="true" />}
                          title={t("refundTitle")}
                          description={t("refundDescription", {
                            amount: f.money(payment.money),
                          })}
                          consequences={[
                            t("refundEffect"),
                            t("refundProvider"),
                            t("audited"),
                          ]}
                          confirmLabel={t("refundConfirm")}
                          hidden={{ paymentId: payment.id }}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>

      <Panel flush id="events" title={t("eventsTitle")} note={t("eventsNote")}>
        {detail.events.length === 0 ? (
          <EmptyState size="sm" title={t("noEvents")} />
        ) : (
          <DataTable label={t("eventsTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("colType")}</th>
                <th scope="col">{t("colStatus")}</th>
                <th scope="col">{t("colReceived")}</th>
                <th scope="col">{t("colProcessed")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((event) => (
                <tr key={event.id}>
                  <td data-primary="">
                    <Link
                      href={`/payments/events/${event.id}`}
                      className="row-link cell-main"
                      prefetch={false}
                    >
                      {event.type}
                    </Link>
                    <span className="cell-sub mono">
                      {event.rawType ?? event.source}
                    </span>
                  </td>
                  <td data-label={t("colStatus")}>
                    <Status tone={toneOf("event", event.status)}>
                      {label("event", event.status)}
                    </Status>
                  </td>
                  <td data-label={t("colReceived")}>
                    <Time iso={event.receivedAt} />
                  </td>
                  <td data-label={t("colProcessed")}>
                    <Time iso={event.processedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>

      {detail.refunds.length > 0 && (
        <Panel flush id="refunds" title={t("refunds")}>
          <DataTable label={t("refunds")}>
            <thead>
              <tr>
                <th scope="col">{t("colCase")}</th>
                <th scope="col" className="num">
                  {t("colAmount")}
                </th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.refunds.map((refund) => (
                <tr key={refund.id}>
                  <td data-primary="">
                    <span className="cell-main">
                      {label("refundKind", refund.kind)}
                    </span>
                    <span className="cell-sub">
                      {refund.reason ??
                        refund.providerRef ??
                        shortId(refund.id)}
                    </span>
                  </td>
                  <td data-label={t("colAmount")} className="num nowrap">
                    {refund.money ? f.money(refund.money) : "—"}
                  </td>
                  <td data-label={t("colState")}>
                    <Status tone={toneOf("refund", refund.state)}>
                      {label("refund", refund.state)}
                    </Status>
                  </td>
                  <td data-label={t("colCreated")}>
                    <Time iso={refund.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}
    </>
  );
}
