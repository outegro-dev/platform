import { Button } from "@outegro/ui/button";
import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  ClockCounterClockwiseIcon,
  CloudSlashIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { RetryButton } from "@/components/retry-button";
import { StatePanel } from "@/components/state-panel";
import { SubscriptionCard } from "@/components/subscription/subscription-card";
import { payments, requireToken } from "@/lib/api";
import { groupSubscriptions } from "@/lib/payments/status";
import { signInPath } from "@/lib/sso";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscriptions");
  return { title: t("metaTitle") };
}

export default async function SubscriptionsPage({
  searchParams,
}: PageProps<"/subscriptions">) {
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  const from = cursor
    ? `/subscriptions?cursor=${encodeURIComponent(cursor)}`
    : "/subscriptions";
  const token = await requireToken(from);
  const [subscriptions, catalog] = await Promise.all([
    payments.subscriptions(token, { cursor, limit: 50 }),
    payments.catalog(),
  ]);
  if (!subscriptions.ok && subscriptions.error === "unauthorized")
    redirect(signInPath(from));

  const t = await getTranslations("subscriptions");
  const states = await getTranslations("states");
  const head = (
    <PageHead
      index={t("index")}
      eyebrow={t("eyebrow")}
      title={t("title")}
      accent={t("titleAccent")}
      lead={t("lead")}
    />
  );

  if (!subscriptions.ok) {
    return (
      <>
        {head}
        {subscriptions.error === "invalid" ||
        subscriptions.error === "not-found" ? (
          <StatePanel
            icon={<ClockCounterClockwiseIcon />}
            title={states("invalidTitle")}
            body={states("invalidBody")}
            actions={
              <Button asChild size="lg" variant="outline">
                <Link href="/subscriptions">{states("invalidAction")}</Link>
              </Button>
            }
          />
        ) : (
          <StatePanel
            tone="danger"
            role="alert"
            icon={<CloudSlashIcon />}
            title={states("unavailableTitle")}
            body={t("unavailableBody")}
            actions={<RetryButton />}
          />
        )}
      </>
    );
  }

  const { items, nextCursor } = subscriptions.data;
  if (items.length === 0 && !cursor) {
    return (
      <>
        {head}
        <StatePanel
          icon={<ArrowsClockwiseIcon />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          actions={
            <Button asChild size="lg">
              <Link href="/catalog">
                {t("emptyAction")}
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const services = new Map(
    catalog.ok ? catalog.data.products.map((p) => [p.key, p.service]) : [],
  );
  const { current, past } = groupSubscriptions(items);
  const card = (sub: (typeof items)[number]) => {
    const service = services.get(sub.productKey) ?? null;
    return (
      <li key={sub.id}>
        <SubscriptionCard initial={sub} service={service} />
      </li>
    );
  };

  return (
    <>
      {head}
      {current.length > 0 && (
        <section className="sub-section" aria-labelledby="subs-current">
          <h2 id="subs-current" className="section-title">
            {t("current")} <span className="count">{current.length}</span>
          </h2>
          <ul className="sub-list">{current.map(card)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section className="sub-section" aria-labelledby="subs-past">
          <h2 id="subs-past" className="section-title">
            {t("past")} <span className="count">{past.length}</span>
          </h2>
          <ul className="sub-list">{past.map(card)}</ul>
        </section>
      )}
      {nextCursor && (
        <nav className="pager" aria-label={t("eyebrow")}>
          <Button asChild variant="outline">
            <Link
              href={`/subscriptions?cursor=${encodeURIComponent(nextCursor)}`}
            >
              {t("more")}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </nav>
      )}
    </>
  );
}
