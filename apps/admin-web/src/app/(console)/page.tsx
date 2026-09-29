import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { BattleshipPanel } from "@/components/dashboard/battleship-panel";
import {
  HealthPanel,
  HealthSkeleton,
} from "@/components/dashboard/health-panel";
import { IdentityPanel } from "@/components/dashboard/identity-panel";
import { NotificationsPanel } from "@/components/dashboard/notifications-panel";
import { PaymentsPanel } from "@/components/dashboard/payments-panel";
import { RecentAuditPanel } from "@/components/dashboard/recent-audit-panel";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { pageAccess } from "@/lib/access";
import { getFormatter } from "@/lib/request";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

function partOfDay(
  hour: number,
): "morning" | "afternoon" | "evening" | "night" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

/**
 * Everything on one page. Each panel streams on its own with its own
 * skeleton of the final size, error and retry: one failing service never
 * blanks the others, and a failure never shows up as zeros.
 */
export default async function DashboardPage() {
  const access = await pageAccess(null);
  if (!access.ok) return access.element;
  const { operator, granted } = access;
  const t = await getTranslations("dashboard");
  const f = await getFormatter();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: f.timeZone,
    }).format(f.now),
  );
  const name =
    operator.displayName?.trim().split(/\s+/)[0] ||
    operator.email.split("@")[0];
  const today = new Intl.DateTimeFormat(f.locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: f.timeZone,
  }).format(f.now);

  return (
    <div className="page">
      <header className="hero">
        <div className="page-head-text">
          <p className="og-eyebrow">{today}</p>
          <h1 className="hero-title">
            {t(`greeting.${partOfDay(hour)}`)},{" "}
            <span className="og-accent">{name}</span>
          </h1>
          <p className="page-lead">{t("lead")}</p>
        </div>
        {granted.has("users.read") && (
          <Form
            action="/users"
            className="search-form"
            role="search"
            aria-label={t("searchLabel")}
          >
            <label htmlFor="quick-search" className="sr-only">
              {t("searchLabel")}
            </label>
            <Input
              id="quick-search"
              name="query"
              type="search"
              placeholder={t("searchPlaceholder")}
              autoComplete="off"
            />
            <Button type="submit" size="md" variant="primary">
              <MagnifyingGlassIcon aria-hidden="true" />
              {t("search")}
            </Button>
          </Form>
        )}
      </header>

      <Suspense fallback={<HealthSkeleton />}>
        <HealthPanel />
      </Suspense>

      <div className="grid-2">
        <Suspense
          fallback={
            <PanelSkeleton
              className="h-panel-sm"
              label={t("attention.title")}
              stats={0}
              rows={4}
            />
          }
        >
          <AttentionPanel granted={granted} />
        </Suspense>
        {(granted.has("audit.read") || granted.has("battleship.read")) && (
          <Suspense
            fallback={
              <PanelSkeleton
                className="h-panel-sm"
                label={t("audit.title")}
                stats={0}
                rows={6}
              />
            }
          >
            <RecentAuditPanel granted={granted} />
          </Suspense>
        )}
      </div>

      <div className="grid-2">
        {granted.has("users.read") && (
          <Suspense
            fallback={
              <PanelSkeleton
                className="h-panel"
                label={t("identity.title")}
                chart
                rows={2}
              />
            }
          >
            <IdentityPanel />
          </Suspense>
        )}
        {granted.has("notifications.read") && (
          <Suspense
            fallback={
              <PanelSkeleton
                className="h-panel"
                label={t("notifications.title")}
                chart
                rows={1}
              />
            }
          >
            <NotificationsPanel />
          </Suspense>
        )}
        {granted.has("battleship.read") && (
          <Suspense
            fallback={
              <PanelSkeleton
                className="h-panel"
                label={t("battleship.title")}
                rows={4}
              />
            }
          >
            <BattleshipPanel />
          </Suspense>
        )}
        {granted.has("billing.read") && (
          <Suspense
            fallback={
              <PanelSkeleton
                className="h-panel"
                label={t("payments.title")}
                rows={2}
              />
            }
          >
            <PaymentsPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
