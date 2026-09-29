import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppFooter } from "./app-footer";
import { LocaleSwitcher } from "./locale-switcher";
import { SilverRipple } from "./silver-ripple";

/** Shell for pages outside a session: wordmark, language, the notice, links. */
export async function BareShell({ children }: { children: ReactNode }) {
  const brand = await getTranslations("brand");
  const nav = await getTranslations("nav");
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {nav("skip")}
      </a>
      <header className="app-header bare-header og-container">
        <a href="/orders" className="brand" aria-label={brand("home")}>
          <span className="brand-word">outegro</span>
          <span className="brand-product og-eyebrow">{brand("product")}</span>
        </a>
        <div className="header-actions">
          <LocaleSwitcher />
        </div>
      </header>
      <main id="main" className="app-main bare-main og-container" tabIndex={-1}>
        <SilverRipple size="lg" />
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
