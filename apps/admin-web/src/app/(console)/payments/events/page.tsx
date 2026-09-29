import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  DataTable,
  FilterBar,
  Pager,
  SelectField,
  TextField,
  Time,
} from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { eventStatuses } from "@/lib/adapters/payments";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.events");
  return { title: t("title") };
}

type Filter = {
  status?: string;
  type?: string;
  contractId?: string;
  orderId?: string;
  cursor?: string;
};

async function EventsTable({ filter }: { filter: Filter }) {
  const t = await getTranslations("payments.events");
  const label = await getLabels();
  const result = await load(() =>
    services().payments.events({ ...filter, limit: 25 }),
  );
  if (!result.ok) {
    return (
      <Panel
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
  const { items, nextCursor } = result.data;
  const filtered = Boolean(
    filter.status || filter.type || filter.contractId || filter.orderId,
  );
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          search={filtered}
          title={filtered ? t("noMatch") : t("empty")}
          body={filtered ? t("noMatchBody") : t("emptyBody")}
        />
      </Panel>
    );
  }
  return (
    <Panel flush id="events" title={t("listTitle")}>
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colType")}</th>
            <th scope="col">{t("colStatus")}</th>
            <th scope="col">{t("colContract")}</th>
            <th scope="col">{t("colOrder")}</th>
            <th scope="col" className="num">
              {t("colAttempts")}
            </th>
            <th scope="col">{t("colReceived")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((event) => (
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
                  {event.rawType ?? "—"} · {label("eventSource", event.source)}
                </span>
                {(event.lastError || event.note) && (
                  <span
                    className="cell-error"
                    title={event.lastError ?? event.note ?? undefined}
                  >
                    {event.lastError ?? event.note}
                  </span>
                )}
              </td>
              <td data-label={t("colStatus")}>
                <Status tone={toneOf("event", event.status)}>
                  {label("event", event.status)}
                </Status>
              </td>
              <td data-label={t("colContract")}>
                <span className="mono small">
                  {event.contractId ? shortId(event.contractId) : "—"}
                </span>
              </td>
              <td data-label={t("colOrder")}>
                {event.orderId ? (
                  <Link
                    href={`/payments/orders/${event.orderId}`}
                    className="link mono above"
                    prefetch={false}
                  >
                    {shortId(event.orderId)}
                  </Link>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td data-label={t("colAttempts")} className="num">
                {event.attempts}
              </td>
              <td data-label={t("colReceived")}>
                <Time iso={event.receivedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/payments/events"
        params={filter}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("payments.events");
  const label = await getLabels();
  const filter: Filter = {
    status: oneOf(params, "status", eventStatuses),
    type: one(params, "type")?.slice(0, 100),
    contractId: one(params, "contractId")?.slice(0, 128),
    orderId: uuidParam(params, "orderId"),
    cursor: one(params, "cursor"),
  };
  const active = Boolean(
    filter.status || filter.type || filter.contractId || filter.orderId,
  );
  return (
    <>
      <Panel id="event-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/payments/events"
          label={t("filters")}
          active={active}
          inline
        >
          <SelectField
            name="status"
            label={t("status")}
            value={filter.status}
            allLabel={t("anyStatus")}
            options={eventStatuses.map((status) => ({
              value: status,
              label: label("event", status),
            }))}
          />
          <TextField
            name="type"
            label={t("type")}
            value={filter.type}
            placeholder="payment.confirmed"
            type="text"
          />
          <TextField
            name="contractId"
            label={t("contract")}
            value={filter.contractId}
            type="text"
          />
          <TextField
            name="orderId"
            label={t("order")}
            value={filter.orderId}
            type="text"
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(filter)}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <EventsTable filter={filter} />
      </Suspense>
    </>
  );
}
