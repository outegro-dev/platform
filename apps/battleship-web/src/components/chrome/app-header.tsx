import { AccountMenu, AccountMenuPlaceholder } from "@outegro/ui/account-menu";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { loadAccount } from "@/lib/api";
import { env, platformUrls } from "@/lib/env";
import { signInHref } from "@/lib/routes";
import { BrandMark } from "./brand-mark";
import { LocaleSwitcher } from "./locale-switcher";
import { MainNav } from "./nav";
import { PlayerChip } from "./player-chip";

/** Wordmark, sections, language, the player and the account menu (or "Sign in"). */
export async function AppHeader({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("brand");
  const locale = await getLocale();
  return (
    <header className="app-header og-container">
      <Link href="/" className="brand" aria-label={t("home")}>
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span className="brand-word">outegro</span>
        <span className="brand-product og-eyebrow">{t("product")}</span>
      </Link>
      <MainNav />
      <div className="header-actions">
        <LocaleSwitcher />
        {signedIn ? (
          <>
            <PlayerChip />
            {/* Identity answers after the page has started streaming. */}
            <Suspense fallback={<AccountMenuPlaceholder compact />}>
              <PlayerAccountMenu locale={locale} />
            </Suspense>
          </>
        ) : (
          <AccountMenu
            user={null}
            current="battleship"
            urls={platformUrls}
            locale={locale}
            signInHref={signInHref("/")}
            signOut="/auth/sign-out"
          />
        )}
      </div>
    </header>
  );
}

/**
 * The platform account behind the player. The chip next to it already
 * shows the nickname, so the menu button keeps only the avatar.
 */
async function PlayerAccountMenu({ locale }: { locale: string }) {
  const account = await loadAccount();
  return (
    <AccountMenu
      user={{
        name: account?.displayName,
        email: account?.email,
        roles: account?.roles,
      }}
      current="battleship"
      urls={platformUrls}
      locale={locale}
      signInHref={signInHref("/")}
      signOut="/auth/sign-out"
      returnTo={env.APP_URL}
      compact
    />
  );
}
