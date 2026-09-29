"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";
import type { PremiumStatus } from "@/lib/ownership";

/** Premium in words: "Active · renews Oct 29, 2026", "Active until …". */
export function usePremiumStatusText(): (status: PremiumStatus) => string {
  const t = useTranslations("shop");
  const locale = useLocale();
  return (status) => {
    switch (status.kind) {
      case "renews":
        return t("premiumRenews", { date: formatDate(status.date, locale) });
      case "ends":
        return t("premiumEnds", { date: formatDate(status.date, locale) });
      case "cancel-pending":
        return t("premiumCancelPending", {
          date: formatDate(status.date, locale),
        });
      case "overdue":
        return t("premiumOverdue", { date: formatDate(status.date, locale) });
      case "active-until":
        return t("activeUntil", { date: formatDate(status.date, locale) });
      case "active":
        return t("active");
      default:
        return t("premiumOff");
    }
  };
}

/** A link to pay.outegro.dev: it leaves the game, and says so with the arrow. */
export function PayLink({
  href,
  testId,
  children,
}: {
  href: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <a className="pay-link" href={href} data-testid={testId}>
      {children}
      <ArrowUpRightIcon weight="bold" aria-hidden="true" />
    </a>
  );
}
