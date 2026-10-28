import { Button } from "@outegro/ui/button";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { TimeZoneProvider } from "@/components/ui/format";
import type { Viewer } from "@/lib/api";
import { THEME_COOKIE } from "@/lib/constants";
import { ownerTimeZone } from "@/lib/request";
import { themeChoiceOf } from "@/lib/theme";
import { AccountPanel } from "./account-panel";
import { Brand } from "./brand";
import { MenuSheet } from "./menu-sheet";
import { NavLinks } from "./nav-links";
import { TimezoneSync } from "./timezone-sync";

/**
 * Every signed-in page. A desktop (1024 px and up) gets a sidebar with the
 * sections, "Add vacancy" and the account; phones and tablets get a top bar
 * (wordmark, add, menu) and the sections as a tab bar along the bottom.
 */
export async function AppShell({
  viewer,
  mock,
  inboxCount,
  children,
}: {
  viewer: Viewer;
  mock: boolean;
  inboxCount: number | null;
  children: ReactNode;
}) {
  const t = await getTranslations("nav");
  const theme = themeChoiceOf((await cookies()).get(THEME_COOKIE)?.value);
  const timeZone = await ownerTimeZone();
  const account = <AccountPanel viewer={viewer} mock={mock} theme={theme} />;
  return (
    <TimeZoneProvider timeZone={timeZone}>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-inner">
            <Brand />
            <Button asChild className="sidebar-add">
              <Link href="/new">
                <PlusIcon aria-hidden="true" weight="bold" />
                {t("add")}
              </Link>
            </Button>
            <nav aria-label={t("label")} className="sidebar-nav">
              <NavLinks variant="side" inboxCount={inboxCount} />
            </nav>
            <div className="sidebar-foot">{account}</div>
          </div>
        </aside>
        <div className="shell-main">
          <header className="topbar">
            <Brand />
            <div className="topbar-actions">
              <Button asChild size="sm" className="topbar-add">
                <Link href="/new">
                  <PlusIcon aria-hidden="true" weight="bold" />
                  {t("addShort")}
                </Link>
              </Button>
              <MenuSheet>{account}</MenuSheet>
            </div>
          </header>
          {children}
          <nav aria-label={t("label")} className="tabbar">
            <NavLinks variant="tabbar" inboxCount={inboxCount} />
          </nav>
        </div>
      </div>
      <TimezoneSync current={timeZone} />
    </TimeZoneProvider>
  );
}
