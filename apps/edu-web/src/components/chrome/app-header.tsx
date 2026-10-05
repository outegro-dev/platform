import { AccountMenuPlaceholder } from "@outegro/ui/account-menu";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { loadAccount } from "@/lib/api";
import { env, platformUrls } from "@/lib/env";
import { HeaderAccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { LocaleSwitcher } from "./locale-switcher";

/** Wordmark, language and the account menu (or "Sign in"). */
export async function AppHeader() {
  const t = await getTranslations("brand");
  return (
    <header className="app-header og-container">
      <Link href="/" className="brand" aria-label={t("home")}>
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span className="brand-word">outegro</span>
        <span className="brand-product og-eyebrow">{t("product")}</span>
      </Link>
      <div className="header-actions">
        <LocaleSwitcher />
        {/* Same box while Identity answers, so nothing moves. */}
        <Suspense fallback={<AccountMenuPlaceholder />}>
          <ReaderAccount />
        </Suspense>
      </div>
    </header>
  );
}

/**
 * The account as Identity knows it: a session it refuses reads as signed
 * out ("Sign in"); one it did not answer about keeps the menu, unnamed.
 */
async function ReaderAccount() {
  const state = await loadAccount();
  const account = state.status === "signed-in" ? state.account : null;
  return (
    <HeaderAccountMenu
      user={
        state.status === "signed-out"
          ? null
          : {
              name: account?.displayName,
              email: account?.email,
              roles: account?.roles,
            }
      }
      urls={platformUrls}
      returnTo={env.APP_URL}
    />
  );
}
