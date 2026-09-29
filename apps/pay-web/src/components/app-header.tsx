import { Button } from "@outegro/ui/button";
import { Skeleton } from "@outegro/ui/skeleton";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { signOut } from "@/app/actions";
import { loadMe } from "@/lib/api";
import { env } from "@/lib/env";
import { AppNav } from "./app-nav";
import { LocaleSwitcher } from "./locale-switcher";

/** outegro wordmark, the three sections, language, account and sign-out. */
export async function AppHeader() {
  const t = await getTranslations("nav");
  const brand = await getTranslations("brand");
  return (
    <header className="app-header og-container">
      <a href="/orders" className="brand" aria-label={brand("home")}>
        <span className="brand-word">outegro</span>
        <span className="brand-product og-eyebrow">{brand("product")}</span>
      </a>
      <AppNav />
      <div className="header-actions">
        <LocaleSwitcher />
        <Suspense fallback={<AccountChipPlaceholder />}>
          <AccountChip />
        </Suspense>
        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label={t("signOut")}
            title={t("signOut")}
          >
            <SignOutIcon />
          </Button>
        </form>
      </div>
    </header>
  );
}

/** Who is signed in; links to the account at id.outegro.dev. */
async function AccountChip() {
  const t = await getTranslations("nav");
  const me = await loadMe();
  const name = me?.displayName?.trim() || me?.email || null;
  const initial = (name ?? "").trim().charAt(0) || "·";
  return (
    <a
      className="account-chip og-glass"
      href={new URL("/account", env.ID_URL).toString()}
      title={name ?? undefined}
    >
      <span className="account-avatar" aria-hidden="true">
        {initial}
      </span>
      <span className="account-name">{name ?? t("accountFallback")}</span>
      <span className="sr-only">{t("account")}</span>
    </a>
  );
}

/** Same box as the chip while Identity answers, so nothing moves. */
function AccountChipPlaceholder() {
  return (
    <span className="account-chip og-glass" aria-hidden="true">
      <span className="account-avatar" />
      <span className="account-name">
        <Skeleton style={{ height: 12, width: 120 }} />
      </span>
    </span>
  );
}
