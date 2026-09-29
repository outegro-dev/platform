import { Input } from "@outegro/ui/input";
import { GiftIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { grantAccess, revokeAccess } from "@/app/(console)/users/actions";
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
import { grantSources, grantStates } from "@/lib/adapters/payments";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";
import { paymentsCatalog } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.grants");
  return { title: t("title") };
}

type Filter = {
  userId?: string;
  state?: string;
  sourceType?: string;
  cursor?: string;
};

async function GrantsTable({
  filter,
  canAssign,
}: {
  filter: Filter;
  canAssign: boolean;
}) {
  const t = await getTranslations("payments.grants");
  const label = await getLabels();
  const result = await load(() =>
    services().payments.grants({ ...filter, limit: 25 }),
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
  const filtered = Boolean(filter.userId || filter.state || filter.sourceType);
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          search={filtered}
          title={filtered ? t("noMatch") : t("empty")}
          body={t("emptyBody")}
        />
      </Panel>
    );
  }
  return (
    <Panel flush id="grants" title={t("listTitle")}>
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colFeature")}</th>
            <th scope="col">{t("colHolder")}</th>
            <th scope="col">{t("colSource")}</th>
            <th scope="col">{t("colState")}</th>
            <th scope="col">{t("colValid")}</th>
            {canAssign && (
              <th scope="col">
                <span className="sr-only">{t("colActions")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((grant) => (
            <tr key={grant.id}>
              <td data-primary="">
                <span className="cell-main">{grant.feature}</span>
                <span className="cell-sub mono">{grant.service}</span>
              </td>
              <td data-label={t("colHolder")}>
                <Link href={`/users/${grant.userId}`} className="link mono">
                  {shortId(grant.userId)}
                </Link>
              </td>
              <td data-label={t("colSource")}>
                {label("grantSource", grant.sourceType)}
                {grant.reason && (
                  <span className="cell-sub">“{grant.reason}”</span>
                )}
              </td>
              <td data-label={t("colState")}>
                <Status tone={toneOf("grant", grant.state)}>
                  {label("grantState", grant.state)}
                </Status>
                {grant.revokeReason && (
                  <span className="cell-sub">“{grant.revokeReason}”</span>
                )}
              </td>
              <td data-label={t("colValid")}>
                <Time iso={grant.validFrom} format="date" />
                <span className="cell-sub">
                  {grant.validUntil ? (
                    <>
                      {t("until")} <Time iso={grant.validUntil} format="date" />
                    </>
                  ) : (
                    t("forever")
                  )}
                </span>
              </td>
              {canAssign && (
                <td data-label={t("colActions")} className="num">
                  {grant.state === "active" && (
                    <ActionDialog
                      action={revokeAccess}
                      triggerLabel={t("revoke")}
                      triggerVariant="ghost"
                      triggerIcon={<XCircleIcon aria-hidden="true" />}
                      title={t("revokeTitle")}
                      description={t("revokeDescription", {
                        feature: grant.feature,
                      })}
                      consequences={[
                        t("revokeEffect"),
                        t("revokeOthers"),
                        t("audited"),
                      ]}
                      confirmLabel={t("revokeConfirm")}
                      destructive
                      hidden={{ grantId: grant.id }}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pager
        path="/payments/grants"
        params={filter}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("billing.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("payments.grants");
  const label = await getLabels();
  const f = await getFormatter();
  const catalog = await paymentsCatalog();
  const filter: Filter = {
    userId: uuidParam(params, "userId"),
    state: oneOf(params, "state", grantStates),
    sourceType: oneOf(params, "sourceType", grantSources),
    cursor: one(params, "cursor"),
  };
  const canAssign = access.granted.has("grants.assign");
  const lang = f.locale === "ru" ? "ru" : "en";
  const targets = catalog.ok
    ? [
        ...new Map(
          catalog.data.products.map((p) => [
            `${p.service}:${p.feature}`,
            p.title[lang],
          ]),
        ),
      ]
    : [];
  return (
    <>
      <Panel
        id="grant-filters"
        title={t("title")}
        note={t("lead")}
        action={
          canAssign && catalog.ok ? (
            <ActionDialog
              action={grantAccess}
              triggerLabel={t("give")}
              triggerVariant="primary"
              triggerIcon={<GiftIcon aria-hidden="true" />}
              title={t("giveTitle")}
              description={t("giveDescription")}
              consequences={[t("giveEffect"), t("giveSource"), t("audited")]}
              confirmLabel={t("giveConfirm")}
            >
              <div className="field">
                <label className="field-label" htmlFor="give-user">
                  {t("userId")}
                </label>
                <Input
                  id="give-user"
                  name="userId"
                  required
                  pattern="[0-9a-fA-F-]{36}"
                  placeholder={t("userIdPlaceholder")}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="give-target">
                  {t("target")}
                </label>
                <select
                  id="give-target"
                  name="target"
                  className="select"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    {t("chooseTarget")}
                  </option>
                  {targets.map(([value, title]) => (
                    <option key={value} value={value}>
                      {title} ({value})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="give-until">
                  {t("until")}
                </label>
                <Input id="give-until" name="validUntil" type="date" />
                <span className="field-hint">{t("untilHint")}</span>
              </div>
            </ActionDialog>
          ) : undefined
        }
      >
        <FilterBar
          action="/payments/grants"
          label={t("filters")}
          active={Boolean(filter.userId || filter.state || filter.sourceType)}
          inline
        >
          <TextField
            name="userId"
            label={t("userId")}
            value={filter.userId}
            placeholder={t("userIdPlaceholder")}
            type="text"
          />
          <SelectField
            name="state"
            label={t("state")}
            value={filter.state}
            allLabel={t("anyState")}
            options={grantStates.map((state) => ({
              value: state,
              label: label("grantState", state),
            }))}
          />
          <SelectField
            name="sourceType"
            label={t("source")}
            value={filter.sourceType}
            allLabel={t("anySource")}
            options={grantSources.map((source) => ({
              value: source,
              label: label("grantSource", source),
            }))}
          />
        </FilterBar>
      </Panel>
      <Suspense
        key={JSON.stringify(filter)}
        fallback={<TableSkeleton label={t("listTitle")} withFilters={false} />}
      >
        <GrantsTable filter={filter} canAssign={canAssign} />
      </Suspense>
    </>
  );
}
