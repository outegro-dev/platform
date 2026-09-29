import { Button } from "@outegro/ui/button";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { Operator } from "@/lib/adapters/identity";
import { env } from "@/lib/env";
import { navigationFor } from "@/lib/permissions";
import { operatorTimeZone } from "@/lib/request";
import { environmentOf } from "@/lib/session";
import { StoresProvider } from "@/stores/provider";
import { IdleGuard } from "./idle-guard";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileBar } from "./mobile-bar";
import { type NavGroup, NavLinks } from "./nav-links";
import { TimezoneSync } from "./timezone-sync";
import { Toaster } from "./toaster";

export function initials(operator: Pick<Operator, "displayName" | "email">) {
  const source = operator.displayName?.trim() || operator.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Sidebar, phone bar, idle timer and toasts around every console page. */
export async function ConsoleShell({
  operator,
  children,
}: {
  operator: Operator;
  children: ReactNode;
}) {
  const t = await getTranslations("shell");
  const environment = environmentOf(env.APP_URL);
  const groups: NavGroup[] = navigationFor(operator.permissions).map(
    (section) => ({
      key: section.key,
      label: t(`groups.${section.key}`),
      items: section.items.map((item) => ({
        key: item.key,
        href: item.href,
        label: t(`nav.${item.key}`),
      })),
    }),
  );

  const brand = (
    <div className="brand-home-wrap">
      <Link href="/" className="brand-home" aria-label={t("home")}>
        <span className="brand-word">outegro</span>
        <span className="og-eyebrow">{t("product")}</span>
      </Link>
    </div>
  );
  const sidebar = (
    <>
      <NavLinks groups={groups} label={t("sections")} />
      <div className="sidebar-foot">
        <div className="operator">
          <span className="avatar" aria-hidden="true">
            {initials(operator)}
          </span>
          <span className="operator-text">
            <span className="operator-name">
              {operator.displayName || operator.email}
            </span>
            <span className="operator-roles">
              {operator.roles.length
                ? operator.roles
                    .map((role) =>
                      t.has(`roles.${role}`) ? t(`roles.${role}`) : role,
                    )
                    .join(" · ")
                : t("noRoles")}
            </span>
          </span>
        </div>
        <div className="sidebar-actions">
          <LocaleSwitcher />
          <form method="post" action="/auth/sign-out">
            <Button type="submit" variant="ghost" size="sm">
              <SignOutIcon aria-hidden="true" />
              {t("signOut")}
            </Button>
          </form>
        </div>
      </div>
    </>
  );

  return (
    <StoresProvider>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <div className="console">
        <aside className="sidebar" aria-label={t("sidebar")}>
          <div className="sidebar-inner">
            <div className="brand">
              {brand}
              <span className="env-badge" data-env={environment}>
                {t(`env.${environment}`)}
              </span>
            </div>
            {sidebar}
          </div>
        </aside>
        <div className="main">
          <MobileBar brand={brand}>{sidebar}</MobileBar>
          <main id="main" className="content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <Toaster />
      <IdleGuard />
      <TimezoneSync current={await operatorTimeZone()} />
    </StoresProvider>
  );
}
