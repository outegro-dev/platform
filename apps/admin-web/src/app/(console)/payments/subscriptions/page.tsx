import { ProhibitIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { cancelSubscription } from "@/app/(console)/payments/actions";
import { ActionDialog } from "@/components/ui/action-dialog";
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
import { canStopRenewal, subscriptionStates } from "@/lib/adapters/payments";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";
import { paymentsCatalog } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.subscriptions");
  return { title: t("title") };
}

type Filter = {
  state?: string;
  productKey?: string;
  userId?: string;
  cursor?: string;
};

async function SubscriptionsTable({
  filter,
  canCancel,
}: {
  filter: Filter;
  canCancel: boolean;
}) {
  const t = await getTranslations("payments.subscriptions");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().payments.subscriptions({ ...filter, limit: 25 }),
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
  const filtered = Boolean(filter.state || filter.productKey || filter.userId);
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
  const lang = f.locale === "ru" ? "ru" : "en";
  return (
    <Panel flush id="subscriptions" title={t("listTitle")}>
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colProduct")}</th>
            <th scope="col">{t("colState")}</th>
            <th scope="col">{t("colSubscriber")}</th>
            <th scope="col">{t("colPaidUntil")}</th>
            <th scope="col" className="num">
              {t("colAmount")}
            </th>
            {canCancel && (
              <th scope="col">
                <span className="sr-only">{t("colActions")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((subscription) => (
            <tr key={subscription.id}>
              <td data-primary="">
                <Link
                  href={`/payments/orders/${subscription.orderId}`}
                  className="row-link cell-main"
                  prefetch={false}
                >
                  {subscription.title?.[lang] ?? subscription.productKey}
                </Link>
                <span className="cell-sub">
                  {label("periodicity", subscription.periodicity)}
                  {subscription.autoRenew
                    ? ` · ${t("autoRenew")}`
                    : ` · ${t("noRenew")}`}
                </span>
              </td>
              <td data-label={t("colState")}>
                <Status tone={toneOf("subscription", subscription.state)}>
                  {label("subscription", subscription.state)}
                </Status>
              </td>
              <td data-label={t("colSubscriber")}>
                {subscription.userId ? (
                  <Link
                    href={`/users/${subscription.userId}`}
                    className="link mono above"
                    prefetch={false}
                  >
                    {shortId(subscription.userId)}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td data-label={t("colPaidUntil")}>
                <Time iso={subscription.paidUntil} format="date" />
                <span className="cell-sub">
                  {t("accessUntil")}{" "}
                  <Time iso={subscription.accessUntil} format="date" />
                </span>
              </td>
              <td data-label={t("colAmount")} className="num nowrap">
                {f.money(subscription.money)}
              </td>
              {canCancel && (
                <td data-label={t("colActions")} className="num">
                  {canStopRenewal(subscription) && (
                    <span className="above">
                      <ActionDialog
                        action={cancelSubscription}
                        triggerLabel={t("cancel")}
                        triggerVariant="ghost"
                        triggerIcon={<ProhibitIcon aria-hidden="true" />}
                        title={t("cancelTitle")}
                        description={t("cancelDescription", {
                          until: f.date(subscription.accessUntil),
                        })}
                        consequences={[
                          ...(subscription.state === "cancel_requested"
                            ? [t("cancelAgain")]
                            : []),
                          t("cancelEffect"),
                          t("cancelKeeps"),
                          t("cancelNoRefund"),
                          t("audited"),
                        ]}
                        confirmLabel={t("cancelConfirm")}
                        destructive
                        hidden={{ subscriptionId: subscription.id }}
                      />
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/payments/subscriptions"
        params={filter}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("payments.subscriptions");
  const label = await getLabels();
  const f = await getFormatter();
  const catalog = await paymentsCatalog();
  const filter: Filter = {
    state: oneOf(params, "state", subscriptionStates),
    productKey: one(params, "productKey"),
    userId: uuidParam(params, "userId"),
    cursor: one(params, "cursor"),
  };
  const lang = f.locale === "ru" ? "ru" : "en";
  return (
    <>
      <Panel id="subscription-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/payments/subscriptions"
          label={t("filters")}
          active={Boolean(filter.state || filter.productKey || filter.userId)}
          inline
        >
          <SelectField
            name="state"
            label={t("state")}
            value={filter.state}
            allLabel={t("anyState")}
            options={subscriptionStates.map((state) => ({
              value: state,
              label: label("subscription", state),
            }))}
          />
          {catalog.ok ? (
            <SelectField
              name="productKey"
              label={t("product")}
              value={filter.productKey}
              allLabel={t("anyProduct")}
              options={catalog.data.products
                .filter((product) => product.kind === "subscription")
                .map((product) => ({
                  value: product.key,
                  label: product.title[lang],
                }))}
            />
          ) : (
            <TextField
              name="productKey"
              label={t("product")}
              value={filter.productKey}
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
        key={JSON.stringify(filter)}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <SubscriptionsTable
          filter={filter}
          canCancel={access.granted.has("subscriptions.cancel")}
        />
      </Suspense>
    </>
  );
}
