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
import {
  type DeliveryFilter,
  deliveryStates,
  externalChannels,
} from "@/lib/adapters/notifications";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";
import { templatesList } from "@/lib/queries";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.deliveries");
  return { title: t("title") };
}

async function DeliveriesTable({ filter }: { filter: DeliveryFilter }) {
  const t = await getTranslations("notifications.deliveries");
  const label = await getLabels();
  const result = await load(() =>
    services().notifications.deliveries({ ...filter, limit: 25 }),
  );
  if (!result.ok) {
    return (
      <Panel>
        <FailureState failure={result} what={t("what")} />
      </Panel>
    );
  }
  const { items, nextCursor } = result.data;
  const filtered = Boolean(
    filter.state || filter.channel || filter.template || filter.userId,
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
    <Panel flush id="deliveries" title={t("listTitle")}>
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colMessage")}</th>
            <th scope="col">{t("colChannel")}</th>
            <th scope="col">{t("colState")}</th>
            <th scope="col" className="num">
              {t("colAttempts")}
            </th>
            <th scope="col">{t("colRecipient")}</th>
            <th scope="col">{t("colCreated")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((delivery) => (
            <tr key={delivery.id}>
              <td data-primary="">
                <Link
                  href={`/notifications/deliveries/${delivery.id}`}
                  className="row-link cell-main"
                  prefetch={false}
                >
                  {delivery.title}
                </Link>
                <span className="cell-sub mono">{delivery.templateKey}</span>
                {delivery.lastError && (
                  <span className="cell-error" title={delivery.lastError}>
                    {delivery.lastError}
                  </span>
                )}
              </td>
              <td data-label={t("colChannel")}>
                {label("channel", delivery.channel)}
              </td>
              <td data-label={t("colState")}>
                <Status tone={toneOf("delivery", delivery.state)}>
                  {label("delivery", delivery.state)}
                </Status>
              </td>
              <td data-label={t("colAttempts")} className="num">
                {delivery.attempts}
              </td>
              <td data-label={t("colRecipient")}>
                <Link
                  href={`/users/${delivery.userId}`}
                  className="link mono above"
                  prefetch={false}
                >
                  {shortId(delivery.userId)}
                </Link>
              </td>
              <td data-label={t("colCreated")}>
                <Time iso={delivery.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/notifications/deliveries"
        params={{
          state: filter.state,
          channel: filter.channel,
          template: filter.template,
          userId: filter.userId,
          cursor: filter.cursor,
        }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("notifications.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("notifications.deliveries");
  const label = await getLabels();
  const templates = await templatesList();
  const filter: DeliveryFilter = {
    state: oneOf(params, "state", deliveryStates),
    channel: oneOf(params, "channel", externalChannels),
    template: one(params, "template"),
    userId: uuidParam(params, "userId"),
    cursor: one(params, "cursor"),
  };
  const active = Boolean(
    filter.state || filter.channel || filter.template || filter.userId,
  );
  const key = JSON.stringify(filter);
  return (
    <>
      <Panel id="delivery-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/notifications/deliveries"
          label={t("filters")}
          active={active}
          inline
        >
          <SelectField
            name="state"
            label={t("state")}
            value={filter.state}
            allLabel={t("anyState")}
            options={deliveryStates.map((state) => ({
              value: state,
              label: label("delivery", state),
            }))}
          />
          <SelectField
            name="channel"
            label={t("channel")}
            value={filter.channel}
            allLabel={t("anyChannel")}
            options={externalChannels.map((channel) => ({
              value: channel,
              label: label("channel", channel),
            }))}
          />
          {templates.ok ? (
            <SelectField
              name="template"
              label={t("template")}
              value={filter.template}
              allLabel={t("anyTemplate")}
              options={templates.data.map((template) => ({
                value: template.key,
                label: template.key,
              }))}
            />
          ) : (
            <TextField
              name="template"
              label={t("template")}
              value={filter.template}
              type="text"
            />
          )}
          <TextField
            name="userId"
            label={t("userId")}
            value={filter.userId}
            placeholder={t("userIdPlaceholder")}
            type="text"
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={key}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <DeliveriesTable filter={filter} />
      </Suspense>
    </>
  );
}
