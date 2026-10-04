import { Input } from "@outegro/ui/input";
import { GiftIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { grantAccess, revokeAccess } from "@/app/(console)/users/actions";
import { AuditFeed } from "@/components/audit/audit-feed";
import { ReaderProgressTable } from "@/components/education/reader-progress";
import { ActionDialog } from "@/components/ui/action-dialog";
import { DataTable, Time } from "@/components/ui/data";
import { Facts, Panel, PanelLink, Stat, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import type { UserDetail } from "@/lib/adapters/identity";
import { bookOfFeature, grantTargetOf, libraryFeature } from "@/lib/education";
import { grantTargets } from "@/lib/grant-targets";
import { grantPhase } from "@/lib/grants";
import { getLabels } from "@/lib/labels";
import { educationBooks } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function AccessTab({
  detail,
  granted,
  name,
}: {
  detail: UserDetail;
  granted: ReadonlySet<string>;
  name: string;
}) {
  const t = await getTranslations("users.access");
  const label = await getLabels();
  const f = await getFormatter();
  const readBilling = granted.has("billing.read");
  const [payments, catalog] = readBilling
    ? await Promise.all([
        load(() =>
          services().payments.grants({ userId: detail.user.id, limit: 50 }),
        ),
        load(() => services().payments.catalog()),
        // Fetched alongside: the books "Give access" offers (cached per request).
        granted.has("grants.assign") && granted.has("edu.read")
          ? educationBooks()
          : null,
      ])
    : [null, null];
  const canGrant = granted.has("grants.assign") && payments?.ok;
  const targets =
    canGrant && catalog?.ok
      ? await grantTargets(
          granted,
          catalog.data.products.map((product) => [
            `${product.service}:${product.feature}`,
            product.title[f.locale === "ru" ? "ru" : "en"],
          ]),
        )
      : [];

  return (
    <div className="stack">
      <Panel flush id="access" title={t("title")} note={t("note")}>
        {detail.grants.length === 0 ? (
          <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
        ) : (
          <DataTable label={t("title")}>
            <thead>
              <tr>
                <th scope="col">{t("colFeature")}</th>
                <th scope="col">{t("colSource")}</th>
                <th scope="col">{t("colUntil")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.grants.map((grant) => (
                <tr key={grant.grantId}>
                  <td data-primary="">
                    <span className="cell-main">{grant.feature}</span>
                    <span className="cell-sub mono">{grant.service}</span>
                  </td>
                  <td data-label={t("colSource")}>
                    {label("grantSource", grant.sourceType)}
                  </td>
                  <td data-label={t("colUntil")}>
                    {grant.validUntil ? (
                      <Time iso={grant.validUntil} />
                    ) : (
                      <span className="muted">{t("forever")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>

      {payments && (
        <Panel
          flush
          id="payments-grants"
          title={t("ledgerTitle")}
          note={t("ledgerNote")}
          kind={
            !payments.ok && payments.kind === "not-connected"
              ? "not-connected"
              : undefined
          }
          action={
            canGrant ? (
              <ActionDialog
                action={grantAccess}
                triggerLabel={t("give")}
                triggerVariant="primary"
                triggerIcon={<GiftIcon aria-hidden="true" />}
                title={t("giveTitle")}
                description={t("giveDescription", { name })}
                consequences={[t("giveEffect"), t("giveSource"), t("audited")]}
                confirmLabel={t("giveConfirm")}
                hidden={{ userId: detail.user.id }}
              >
                <div className="field">
                  <label className="field-label" htmlFor="grant-target">
                    {t("target")}
                  </label>
                  <select
                    id="grant-target"
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
                  <label className="field-label" htmlFor="grant-until">
                    {t("until")}
                  </label>
                  <Input id="grant-until" name="validUntil" type="date" />
                  <span className="field-hint">{t("untilHint")}</span>
                </div>
              </ActionDialog>
            ) : undefined
          }
        >
          {!payments.ok ? (
            <FailureState
              failure={payments}
              what={t("ledgerWhat")}
              service={t("paymentsService")}
            />
          ) : payments.data.items.length === 0 ? (
            <EmptyState size="sm" title={t("ledgerEmpty")} />
          ) : (
            <DataTable label={t("ledgerTitle")}>
              <thead>
                <tr>
                  <th scope="col">{t("colFeature")}</th>
                  <th scope="col">{t("colSource")}</th>
                  <th scope="col">{t("colState")}</th>
                  <th scope="col">{t("colUntil")}</th>
                  {granted.has("grants.assign") && (
                    <th scope="col">
                      <span className="sr-only">{t("colActions")}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {payments.data.items.map((grant) => (
                  <tr key={grant.id}>
                    <td data-primary="">
                      <span className="cell-main">{grant.feature}</span>
                      <span className="cell-sub mono">{grant.service}</span>
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
                    </td>
                    <td data-label={t("colUntil")}>
                      {grant.validUntil ? (
                        <Time iso={grant.validUntil} />
                      ) : (
                        <span className="muted">{t("forever")}</span>
                      )}
                    </td>
                    {granted.has("grants.assign") && (
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
                              name,
                            })}
                            consequences={[
                              t("revokeEffect"),
                              ...(grant.sourceType === "subscription"
                                ? [t("revokeRenewal")]
                                : []),
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
          )}
        </Panel>
      )}
    </div>
  );
}

export async function NotificationsTab({ userId }: { userId: string }) {
  const t = await getTranslations("users.notifications");
  const label = await getLabels();
  const result = await load(() => services().notifications.recipient(userId));
  if (!result.ok) {
    return (
      <Panel id="recipient" title={t("title")}>
        {result.kind === "not-found" ? (
          <EmptyState title={t("noRecipient")} body={t("noRecipientBody")} />
        ) : (
          <FailureState failure={result} what={t("what")} />
        )}
      </Panel>
    );
  }
  const recipient = result.data;
  return (
    <div className="stack">
      <Panel
        id="recipient"
        title={t("title")}
        action={
          <PanelLink href={`/notifications/deliveries?userId=${userId}`}>
            {t("allDeliveries")}
          </PanelLink>
        }
      >
        <Facts
          items={[
            {
              label: t("email"),
              value: <span className="mono">{recipient.email ?? "—"}</span>,
            },
            {
              label: t("verified"),
              value: recipient.emailVerified ? t("yes") : t("no"),
            },
            { label: t("language"), value: label("locale", recipient.locale) },
            {
              label: t("status"),
              value: (
                <Status tone={toneOf("user", recipient.status)}>
                  {label("userStatus", recipient.status)}
                </Status>
              ),
            },
            {
              label: t("telegram"),
              value: recipient.telegram.linked ? (
                <span>
                  {t("linked")} ·{" "}
                  <Time iso={recipient.telegram.linkedAt} format="date" />
                </span>
              ) : (
                <span className="muted">{t("notLinked")}</span>
              ),
            },
            {
              label: t("optOuts"),
              value:
                recipient.optOuts.length === 0 ? (
                  <span className="muted">{t("noOptOuts")}</span>
                ) : (
                  <span className="row-gap">
                    {recipient.optOuts.map((item) => (
                      <span
                        key={`${item.category}-${item.channel}`}
                        className="chip"
                        data-tone="muted"
                      >
                        {label("category", item.category)} ·{" "}
                        {label("channel", item.channel)}
                      </span>
                    ))}
                  </span>
                ),
            },
          ]}
        />
      </Panel>
      <Panel flush id="recent-deliveries" title={t("recent")}>
        {recipient.recentDeliveries.length === 0 ? (
          <EmptyState size="sm" title={t("noDeliveries")} />
        ) : (
          <DataTable label={t("recent")}>
            <thead>
              <tr>
                <th scope="col">{t("colMessage")}</th>
                <th scope="col">{t("colChannel")}</th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {recipient.recentDeliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td data-primary="">
                    <Link
                      href={`/notifications/deliveries/${delivery.id}`}
                      className="row-link cell-main"
                      prefetch={false}
                    >
                      {delivery.title}
                    </Link>
                    <span className="cell-sub mono">
                      {delivery.templateKey}
                    </span>
                  </td>
                  <td data-label={t("colChannel")}>
                    {label("channel", delivery.channel)}
                  </td>
                  <td data-label={t("colState")}>
                    <Status tone={toneOf("delivery", delivery.state)}>
                      {label("delivery", delivery.state)}
                    </Status>
                  </td>
                  <td data-label={t("colCreated")}>
                    <Time iso={delivery.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

export async function BattleshipTab({ userId }: { userId: string }) {
  const t = await getTranslations("users.battleship");
  const label = await getLabels();
  const f = await getFormatter();
  const result = await load(() => services().battleship.player(userId));
  if (!result.ok) {
    return (
      <Panel
        id="player"
        title={t("title")}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        {result.kind === "not-found" ? (
          <EmptyState title={t("noPlayer")} body={t("noPlayerBody")} />
        ) : (
          <FailureState
            failure={result}
            what={t("what")}
            service={t("service")}
          />
        )}
      </Panel>
    );
  }
  const { player, stats } = result.data;
  return (
    <Panel
      id="player"
      title={t("title")}
      action={
        <PanelLink href={`/battleship/players/${userId}`}>
          {t("open")}
        </PanelLink>
      }
    >
      <div className="row-gap">
        <span className="cell-main" style={{ fontSize: 20 }}>
          {player.nickname}
        </span>
        <Status tone={toneOf("player", player.status)}>
          {label("userStatus", player.status)}
        </Status>
        {player.online && <Status tone="live">{t("online")}</Status>}
        {player.leaderboardHidden && <Status tone="warn">{t("hidden")}</Status>}
      </div>
      <div className="stats">
        <Stat label={t("rating")} value={f.number(player.rating)} size="lg" />
        <Stat
          label={t("matches")}
          value={f.number(player.matches)}
          hint={t("rated", { count: player.ratedMatches })}
        />
        <Stat
          label={t("record")}
          value={`${f.number(player.wins)} / ${f.number(player.losses)}`}
        />
        <Stat
          label={t("winRate")}
          value={stats?.winRate != null ? f.percent(stats.winRate) : "—"}
        />
      </div>
    </Panel>
  );
}

export async function EducationTab({ userId }: { userId: string }) {
  const t = await getTranslations("users.education");
  const label = await getLabels();
  const f = await getFormatter();
  const [result, books] = await Promise.all([
    load(() => services().education.reader(userId)),
    educationBooks(),
  ]);
  if (!result.ok) {
    return (
      <Panel
        id="reader"
        title={t("title")}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        {result.kind === "not-found" ? (
          <EmptyState title={t("noReader")} body={t("noReaderBody")} />
        ) : (
          <FailureState
            failure={result}
            what={t("what")}
            service={t("service")}
          />
        )}
      </Panel>
    );
  }
  const titles = new Map(
    books.ok ? books.data.map((book) => [book.slug, book.title]) : [],
  );
  const bookTitle = (slug: string) => titles.get(slug) ?? slug;
  const featureName = (feature: string) => {
    const slug = bookOfFeature(feature);
    if (slug) return bookTitle(slug);
    return feature === libraryFeature ? t("library") : feature;
  };
  const { grants, books: progress } = result.data;
  return (
    <div className="stack">
      <Panel
        flush
        id="reader"
        title={t("title")}
        action={
          <PanelLink href={`/education/readers?userId=${userId}`}>
            {t("open")}
          </PanelLink>
        }
      >
        {progress.length === 0 ? (
          <EmptyState size="sm" title={t("noBooks")} />
        ) : (
          <ReaderProgressTable
            title={t("title")}
            rows={progress}
            lead="book"
            bookTitle={bookTitle}
          />
        )}
      </Panel>
      <Panel
        flush
        id="reader-grants"
        title={t("grants")}
        note={t("grantsNote")}
      >
        {grants.length === 0 ? (
          <EmptyState size="sm" title={t("noGrants")} />
        ) : (
          <DataTable label={t("grants")}>
            <thead>
              <tr>
                <th scope="col">{t("colFeature")}</th>
                <th scope="col">{t("colSource")}</th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colValid")}</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => {
                // Scheduled, in force, expired or revoked: from its window,
                // not only from what Payments recorded ("active").
                const phase = grantPhase(grant, f.now);
                return (
                  <tr key={grant.grantId}>
                    <td data-primary="">
                      <span className="cell-main">
                        {featureName(grant.feature)}
                      </span>
                      <span className="cell-sub mono">
                        {grantTargetOf(grant.feature)}
                      </span>
                    </td>
                    <td data-label={t("colSource")}>
                      {label("grantSource", grant.sourceType)}
                    </td>
                    <td data-label={t("colState")}>
                      <Status tone={toneOf("grantPhase", phase)}>
                        {label("grantPhase", phase)}
                      </Status>
                    </td>
                    <td data-label={t("colValid")}>
                      <span>
                        <Time iso={grant.validFrom} format="date" />
                        <span className="cell-sub">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

export async function PaymentsTab({ userId }: { userId: string }) {
  const t = await getTranslations("users.payments");
  const label = await getLabels();
  const f = await getFormatter();
  const [orders, subscriptions] = await Promise.all([
    load(() => services().payments.orders({ userId, limit: 10 })),
    load(() => services().payments.subscriptions({ userId, limit: 10 })),
  ]);
  const lang = f.locale === "ru" ? "ru" : "en";
  if (!orders.ok && orders.kind === "not-connected") {
    return (
      <Panel id="user-payments" title={t("title")} kind="not-connected">
        <FailureState
          failure={orders}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  return (
    <div className="stack">
      <Panel
        flush
        id="user-orders"
        title={t("orders")}
        action={
          <PanelLink href={`/payments/orders?userId=${userId}`}>
            {t("allOrders")}
          </PanelLink>
        }
      >
        {!orders.ok ? (
          <FailureState failure={orders} what={t("orders").toLowerCase()} />
        ) : orders.data.items.length === 0 ? (
          <EmptyState size="sm" title={t("noOrders")} />
        ) : (
          <DataTable label={t("orders")}>
            <thead>
              <tr>
                <th scope="col">{t("colProduct")}</th>
                <th scope="col" className="num">
                  {t("colAmount")}
                </th>
                <th scope="col">{t("colStatus")}</th>
                <th scope="col">{t("colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.items.map((order) => (
                <tr key={order.id}>
                  <td data-primary="">
                    <Link
                      href={`/payments/orders/${order.id}`}
                      className="row-link cell-main"
                      prefetch={false}
                    >
                      {order.title[lang]}
                    </Link>
                    <span className="cell-sub mono">{order.productKey}</span>
                  </td>
                  <td data-label={t("colAmount")} className="num">
                    {f.money(order.money)}
                  </td>
                  <td data-label={t("colStatus")}>
                    <Status tone={toneOf("order", order.status)}>
                      {label("order", order.status)}
                    </Status>
                  </td>
                  <td data-label={t("colCreated")}>
                    <Time iso={order.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
      <Panel flush id="user-subscriptions" title={t("subscriptions")}>
        {!subscriptions.ok ? (
          <FailureState
            failure={subscriptions}
            what={t("subscriptions").toLowerCase()}
          />
        ) : subscriptions.data.items.length === 0 ? (
          <EmptyState size="sm" title={t("noSubscriptions")} />
        ) : (
          <DataTable label={t("subscriptions")}>
            <thead>
              <tr>
                <th scope="col">{t("colProduct")}</th>
                <th scope="col">{t("colStatus")}</th>
                <th scope="col">{t("colPaidUntil")}</th>
                <th scope="col" className="num">
                  {t("colAmount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.data.items.map((subscription) => (
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
                    </span>
                  </td>
                  <td data-label={t("colStatus")}>
                    <Status tone={toneOf("subscription", subscription.state)}>
                      {label("subscription", subscription.state)}
                    </Status>
                  </td>
                  <td data-label={t("colPaidUntil")}>
                    <Time iso={subscription.paidUntil} format="date" />
                  </td>
                  <td data-label={t("colAmount")} className="num">
                    {f.money(subscription.money)}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

export async function ActivityTab({ userId }: { userId: string }) {
  const t = await getTranslations("users.activity");
  const [about, by] = await Promise.all([
    load(() => services().identity.audit({ targetId: userId, limit: 25 })),
    load(() => services().identity.audit({ actorId: userId, limit: 25 })),
  ]);
  const entries = (page: typeof about) =>
    page.ok
      ? page.data.items.map((entry) => ({
          ...entry,
          source: "identity" as const,
          data: entry.data ?? {},
        }))
      : [];
  return (
    <div className="grid-2">
      <Panel
        id="activity-about"
        title={t("about")}
        action={
          <PanelLink href={`/audit?targetId=${userId}`}>{t("open")}</PanelLink>
        }
      >
        {!about.ok ? (
          <FailureState failure={about} what={t("what")} />
        ) : about.data.items.length === 0 ? (
          <EmptyState size="sm" title={t("emptyAbout")} />
        ) : (
          <AuditFeed entries={entries(about)} showSource={false} />
        )}
      </Panel>
      <Panel
        id="activity-by"
        title={t("by")}
        action={
          <PanelLink href={`/audit?actorId=${userId}`}>{t("open")}</PanelLink>
        }
      >
        {!by.ok ? (
          <FailureState failure={by} what={t("what")} />
        ) : by.data.items.length === 0 ? (
          <EmptyState size="sm" title={t("emptyBy")} />
        ) : (
          <AuditFeed entries={entries(by)} showSource={false} />
        )}
      </Panel>
    </div>
  );
}
