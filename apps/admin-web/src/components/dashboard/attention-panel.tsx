import {
  ArrowRightIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  PlugsIcon,
  QuestionIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Panel } from "@/components/ui/layout";
import { RetryButton } from "@/components/ui/retry-button";
import {
  notificationsOverview,
  openIssues,
  reviewRefunds,
  serviceHealth,
  telegramStatus,
  unmatchedEvents,
} from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { deliveryTotals } from "./notifications-panel";

type Item = {
  key: string;
  tone: "bad" | "warn" | "ok" | "neutral";
  icon: ReactNode;
  title: string;
  meta?: string;
  href?: string;
};

const BACKLOG_MINUTES = 10;

/** What needs the operator now, collected from every service they may read. */
export async function AttentionPanel({
  granted,
}: {
  granted: ReadonlySet<string>;
}) {
  const t = await getTranslations("dashboard.attention");
  const f = await getFormatter();
  const items: Item[] = [];
  const unchecked: string[] = [];

  const readNotifications = granted.has("notifications.read");
  const readBilling = granted.has("billing.read");
  const [health, overview, telegram, issues, unmatched, refunds] =
    await Promise.all([
      serviceHealth(),
      readNotifications ? notificationsOverview() : null,
      readNotifications ? telegramStatus() : null,
      readBilling ? openIssues() : null,
      readBilling ? unmatchedEvents() : null,
      readBilling ? reviewRefunds() : null,
    ]);

  for (const service of health) {
    if (service.state === "down" || service.state === "degraded") {
      items.push({
        key: `health-${service.key}`,
        tone: service.state === "down" ? "bad" : "warn",
        icon: <PlugsIcon />,
        title: t(service.state === "down" ? "serviceDown" : "serviceDegraded", {
          service: t(`services.${service.key}`),
        }),
        meta:
          service.checks
            .filter((check) => !check.up)
            .map((check) => check.name)
            .join(", ") || undefined,
      });
    }
  }

  if (overview) {
    if (!overview.ok) unchecked.push(t("services.notifications"));
    else {
      const data = overview.data;
      const { bad } = deliveryTotals(data);
      if (bad > 0)
        items.push({
          key: "deliveries-failed",
          tone: "bad",
          icon: <WarningCircleIcon />,
          title: t("failedDeliveries", { count: bad }),
          meta: t("last24h"),
          href: "/notifications/deliveries?state=failed",
        });
      const oldest = data.backlog.oldestCreatedAt;
      if (
        data.backlog.count > 0 &&
        oldest &&
        f.now - Date.parse(oldest) > BACKLOG_MINUTES * 60_000
      )
        items.push({
          key: "backlog",
          tone: "warn",
          icon: <WarningIcon />,
          title: t("backlog", { count: data.backlog.count }),
          meta: t("oldest", { time: f.relative(oldest) }),
          href: "/notifications/deliveries?state=pending",
        });
      for (const channel of ["email", "telegram"] as const) {
        const settings = data.channels[channel];
        const configured =
          channel === "email" || data.channels.telegram.configured;
        if (configured && !settings.enabled)
          items.push({
            key: `paused-${channel}`,
            tone: "warn",
            icon: <PauseCircleIcon />,
            title: t("channelPaused", { channel: t(`channels.${channel}`) }),
            meta: t("pausedMeta"),
            href: "/notifications/channels",
          });
      }
    }
  }
  if (telegram?.ok && telegram.data.webhook?.lastError) {
    items.push({
      key: "telegram-webhook",
      tone: "warn",
      icon: <WarningIcon />,
      title: t("webhookError"),
      meta: telegram.data.webhook.lastError,
      href: "/notifications/channels",
    });
  }

  const payments = [issues, unmatched, refunds].filter((item) => item !== null);
  const paymentsDown = payments.find(
    (item) => !item.ok && item.kind !== "not-connected",
  );
  if (paymentsDown) unchecked.push(t("services.payments"));
  if (issues?.ok && issues.data.items.length > 0) {
    const high = issues.data.items.filter(
      (issue) => issue.severity === "high",
    ).length;
    items.push({
      key: "issues",
      tone: high > 0 ? "bad" : "warn",
      icon: <WarningCircleIcon />,
      title: t("openIssues", { count: issues.data.items.length }),
      meta: high > 0 ? t("highSeverity", { count: high }) : undefined,
      href: "/payments/issues",
    });
  }
  if (unmatched?.ok && unmatched.data.items.length > 0)
    items.push({
      key: "unmatched",
      tone: "warn",
      icon: <QuestionIcon />,
      title: t("unmatchedEvents", { count: unmatched.data.items.length }),
      href: "/payments/events?status=unmatched",
    });
  if (refunds?.ok && refunds.data.items.length > 0)
    items.push({
      key: "refunds",
      tone: "warn",
      icon: <WarningIcon />,
      title: t("refundsReview", { count: refunds.data.items.length }),
      href: "/payments/refunds?state=review_required",
    });

  const order = { bad: 0, warn: 1, neutral: 2, ok: 3 };
  items.sort((a, b) => order[a.tone] - order[b.tone]);
  if (items.length === 0)
    items.push({
      key: "clear",
      tone: "ok",
      icon: <CheckCircleIcon />,
      title: t("allClear"),
      meta: t("allClearMeta"),
    });

  return (
    <Panel
      id="attention"
      kicker={t("kicker")}
      title={t("title")}
      className="h-panel-feed"
      action={unchecked.length > 0 ? <RetryButton /> : undefined}
    >
      <ul className="attention">
        {items.map((item) => (
          <li key={item.key} className="attention-item" data-tone={item.tone}>
            <span className="attention-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="feed-main">
              <span className="feed-title">{item.title}</span>
              {item.meta && <span className="feed-meta">{item.meta}</span>}
            </span>
            {item.href ? (
              <Link
                href={item.href}
                className="panel-link"
                aria-label={t("openItem", { item: item.title })}
              >
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            ) : (
              <span />
            )}
          </li>
        ))}
        {unchecked.length > 0 && (
          <li className="attention-item" data-tone="neutral">
            <span className="attention-icon" aria-hidden="true">
              <QuestionIcon />
            </span>
            <span className="feed-main">
              <span className="feed-title">
                {t("unchecked", { services: unchecked.join(", ") })}
              </span>
              <span className="feed-meta">{t("uncheckedMeta")}</span>
            </span>
            <span />
          </li>
        )}
      </ul>
    </Panel>
  );
}
