import { AccountMenu, AccountMenuPlaceholder } from "@outegro/ui/account-menu";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { signOut } from "@/app/actions";
import { loadMe } from "@/lib/api";
import { platformUrls } from "@/lib/env";
import { signInPath } from "@/lib/sso";
import { AppNav } from "./app-nav";
import { LocaleSwitcher } from "./locale-switcher";

/** outegro wordmark, the three sections, language and the account menu. */
export async function AppHeader() {
  const brand = await getTranslations("brand");
  const locale = await getLocale();
  return (
    <header className="app-header og-container">
      <a href="/orders" className="brand" aria-label={brand("home")}>
        <span className="brand-word">outegro</span>
        <span className="brand-product og-eyebrow">{brand("product")}</span>
      </a>
      <AppNav />
      <div className="header-actions">
        <LocaleSwitcher />
        {/* Same box while Identity answers, so nothing moves. */}
        <Suspense fallback={<AccountMenuPlaceholder />}>
          <BuyerAccountMenu locale={locale} />
        </Suspense>
      </div>
    </header>
  );
}

/** Who is signed in, their account on id, the apps and sign-out. */
async function BuyerAccountMenu({ locale }: { locale: string }) {
  const me = await loadMe();
  return (
    <AccountMenu
      user={{ name: me?.displayName, email: me?.email, roles: me?.roles }}
      current="pay"
      urls={platformUrls}
      locale={locale}
      signInHref={signInPath("/orders")}
      signOut={signOut}
    />
  );
}
