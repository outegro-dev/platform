import { Input } from "@outegro/ui/input";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { matchRefund } from "@/app/(console)/payments/actions";
import { ActionDialog } from "@/components/ui/action-dialog";
import {
  DataTable,
  FilterBar,
  Pager,
  SelectField,
  Time,
} from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { refundKinds, refundStates } from "@/lib/adapters/payments";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.refunds");
  return { title: t("title") };
}

type Filter = { state?: string; kind?: string; cursor?: string };

/** Refund and chargeback cases; unmatched ones wait for a verified link. */
async function RefundsTable({
  filter,
  canMatch,
}: {
  filter: Filter;
  canMatch: boolean;
}) {
  const t = await getTranslations("payments.refunds");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() =>
    services().payments.refunds({ ...filter, limit: 25 }),
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
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          search={Boolean(filter.state || filter.kind)}
          title={t("empty")}
          body={t("emptyBody")}
        />
      </Panel>
    );
  }
  return (
    <Panel flush id="refunds" title={t("listTitle")}>
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colCase")}</th>
            <th scope="col" className="num">
              {t("colAmount")}
            </th>
            <th scope="col">{t("colState")}</th>
            <th scope="col">{t("colPayment")}</th>
            <th scope="col">{t("colCreated")}</th>
            {canMatch && (
              <th scope="col">
                <span className="sr-only">{t("colActions")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((refund) => (
            <tr key={refund.id}>
              <td data-primary="">
                <span className="cell-main">
                  {label("refundKind", refund.kind)}
                  {refund.refundType
                    ? ` · ${label("refundType", refund.refundType)}`
                    : ""}
                </span>
                <span className="cell-sub mono">
                  {refund.providerRef ?? shortId(refund.id)}
                </span>
                {refund.reason && (
                  <span className="cell-sub">“{refund.reason}”</span>
                )}
              </td>
              <td data-label={t("colAmount")} className="num nowrap">
                {refund.money ? f.money(refund.money) : "—"}
              </td>
              <td data-label={t("colState")}>
                <Status tone={toneOf("refund", refund.state)}>
                  {label("refund", refund.state)}
                </Status>
              </td>
              <td data-label={t("colPayment")}>
                {refund.paymentId ? (
                  <span className="mono small">
                    {shortId(refund.paymentId)}
                  </span>
                ) : (
                  <span className="muted">{t("unlinked")}</span>
                )}
                {refund.userId && (
                  <span className="cell-sub">
                    <Link
                      href={`/users/${refund.userId}`}
                      className="link mono"
                    >
                      {shortId(refund.userId)}
                    </Link>
                  </span>
                )}
              </td>
              <td data-label={t("colCreated")}>
                <Time iso={refund.createdAt} />
              </td>
              {canMatch && (
                <td data-label={t("colActions")} className="num">
                  {!refund.paymentId &&
                    (refund.state === "unmatched" ||
                      refund.state === "review_required") && (
                      <ActionDialog
                        action={matchRefund}
                        triggerLabel={t("match")}
                        triggerVariant="ghost"
                        triggerIcon={<LinkSimpleIcon aria-hidden="true" />}
                        title={t("matchTitle")}
                        description={t("matchDescription")}
                        consequences={[
                          t("matchEffect"),
                          t("matchEvidence"),
                          t("audited"),
                        ]}
                        confirmLabel={t("matchConfirm")}
                        hidden={{ refundId: refund.id }}
                      >
                        <div className="field">
                          <label
                            className="field-label"
                            htmlFor={`match-${refund.id}`}
                          >
                            {t("paymentId")}
                          </label>
                          <Input
                            id={`match-${refund.id}`}
                            name="paymentId"
                            required
                            pattern="[0-9a-fA-F-]{36}"
                            autoComplete="off"
                          />
                          <span className="field-hint">
                            {t("paymentIdHint")}
                          </span>
                        </div>
                      </ActionDialog>
                    )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/payments/refunds"
        params={filter}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("payments.refunds");
  const label = await getLabels();
  const filter: Filter = {
    state: oneOf(params, "state", refundStates),
    kind: oneOf(params, "kind", refundKinds),
    cursor: one(params, "cursor"),
  };
  return (
    <>
      <Panel id="refund-filters" title={t("title")} note={t("lead")}>
        <FilterBar
          action="/payments/refunds"
          label={t("filters")}
          active={Boolean(filter.state || filter.kind)}
          inline
        >
          <SelectField
            name="state"
            label={t("state")}
            value={filter.state}
            allLabel={t("anyState")}
            options={refundStates.map((state) => ({
              value: state,
              label: label("refund", state),
            }))}
          />
          <SelectField
            name="kind"
            label={t("kind")}
            value={filter.kind}
            allLabel={t("anyKind")}
            options={refundKinds.map((kind) => ({
              value: kind,
              label: label("refundKind", kind),
            }))}
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(filter)}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <RefundsTable
          filter={filter}
          canMatch={access.granted.has("refunds.request")}
        />
      </Suspense>
    </>
  );
}
