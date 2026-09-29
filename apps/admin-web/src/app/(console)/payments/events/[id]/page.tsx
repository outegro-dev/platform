import {
  ArrowLeftIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CopyText } from "@/components/ui/copy-text";
import { JsonView, Time } from "@/components/ui/data";
import { Facts, Panel, Status } from "@/components/ui/layout";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import type { Params } from "@/lib/params";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.event");
  return { title: t("title") };
}

/**
 * One provider event as received. The raw payload carries buyer emails:
 * masked unless the operator may read sensitive user data.
 */
export default async function EventPage({ params }: { params: Params<"id"> }) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const { id } = await params;
  const t = await getTranslations("payments.event");
  const label = await getLabels();
  const back = (
    <Link href="/payments/events" className="panel-link" style={{ margin: 0 }}>
      <ArrowLeftIcon aria-hidden="true" />
      {t("back")}
    </Link>
  );
  const result = await load(() => services().payments.event(id));
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
  const event = result.data;
  const sensitive = access.granted.has("users.read.sensitive");
  const link = (href: string | null, value: string | null) =>
    value ? (
      href ? (
        <Link href={href} className="link mono">
          {shortId(value)}
        </Link>
      ) : (
        <CopyText value={value} display={shortId(value)} />
      )
    ) : (
      <span className="muted">—</span>
    );
  return (
    <>
      <Panel
        id="event"
        kicker={label("eventSource", event.source)}
        title={event.type}
        action={back}
      >
        <div className="row-gap">
          <Status tone={toneOf("event", event.status)}>
            {label("event", event.status)}
          </Status>
          {event.rawType && (
            <span className="small mono muted">{event.rawType}</span>
          )}
        </div>
        {(event.lastError || event.note) && (
          <p className="notice" data-tone={event.lastError ? "bad" : "warn"}>
            <WarningCircleIcon aria-hidden="true" />
            <span>{event.lastError ?? event.note}</span>
          </p>
        )}
        <Facts
          items={[
            {
              label: t("id"),
              value: <CopyText value={event.id} display={shortId(event.id)} />,
            },
            { label: t("received"), value: <Time iso={event.receivedAt} /> },
            { label: t("processed"), value: <Time iso={event.processedAt} /> },
            {
              label: t("attempts"),
              value: <span className="num">{event.attempts}</span>,
            },
            { label: t("contract"), value: link(null, event.contractId) },
            {
              label: t("parentContract"),
              value: link(null, event.parentContractId),
            },
            {
              label: t("order"),
              value: link(
                event.orderId ? `/payments/orders/${event.orderId}` : null,
                event.orderId,
              ),
            },
            { label: t("payment"), value: link(null, event.paymentId) },
            {
              label: t("subscription"),
              value: link(null, event.subscriptionId),
            },
            { label: t("refund"), value: link(null, event.refundId) },
            {
              label: t("hash"),
              value: (
                <CopyText
                  value={event.payloadHash}
                  display={shortId(event.payloadHash)}
                />
              ),
            },
          ]}
        />
      </Panel>
      <div className="grid-2">
        <Panel
          id="payload"
          title={t("payload")}
          note={sensitive ? t("payloadFull") : t("payloadMasked")}
        >
          <JsonView
            value={event.payload ?? null}
            label={t("payload")}
            mask={!sensitive}
          />
        </Panel>
        <Panel id="fact" title={t("fact")} note={t("factNote")}>
          <JsonView
            value={event.fact ?? null}
            label={t("fact")}
            mask={!sensitive}
          />
        </Panel>
      </div>
    </>
  );
}
