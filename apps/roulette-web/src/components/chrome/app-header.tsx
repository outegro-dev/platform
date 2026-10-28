import { Button } from "@outegro/ui/button";
import {
  SignInIcon,
  SignOutIcon,
  UserIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { signInHref } from "@/lib/routes";
import { BalanceChip } from "./balance-chip";
import { BrandMark } from "./brand-mark";
import { LocaleSwitcher } from "./locale-switcher";
import { MainNav } from "./nav";

/**
 * The mock's top bar: the wordmark, Roulette and Fairness, the grumbles, the
 * language and the account. The platform account menu of @outegro/ui does
 * not know roulette as an app yet, so the account is two plain links here.
 */
export async function AppHeader({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("brand");
  const account = await getTranslations("account");
  return (
    <header className="app-header og-container">
      <Link href="/" className="brand" aria-label={t("home")}>
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span className="brand-word">outegro</span>
        <span className="brand-dot" aria-hidden="true">
          ●
        </span>
        <span className="brand-product">{t("product")}</span>
      </Link>
      <MainNav />
      <div className="header-actions">
        {signedIn ? <BalanceChip /> : null}
        <LocaleSwitcher />
        {signedIn ? (
          <>
            <Button asChild size="sm" variant="outline">
              <a href={`${env.ID_URL}/account`}>
                <UserIcon />
                <span className="max-sm:sr-only">{account("account")}</span>
              </a>
            </Button>
            <form action="/auth/sign-out" method="post">
              <Button type="submit" size="sm" variant="ghost">
                <SignOutIcon />
                <span className="max-sm:sr-only">{account("signOut")}</span>
              </Button>
            </form>
          </>
        ) : (
          <Button asChild size="sm">
            <a href={signInHref("/")} rel="nofollow">
              <SignInIcon />
              {account("signIn")}
            </a>
          </Button>
        )}
      </div>
    </header>
  );
}
