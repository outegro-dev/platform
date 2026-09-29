import { Button } from "@outegro/ui/button";
import { SignInIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "./brand-mark";
import { LocaleSwitcher } from "./locale-switcher";
import { MainNav } from "./nav";
import { PlayerChip } from "./player-chip";

/** Wordmark, sections, language, and the player (or "Sign in"). */
export async function AppHeader({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("brand");
  const nav = await getTranslations("nav");
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
            <form
              action="/auth/sign-out"
              method="post"
              className="header-signout"
            >
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label={nav("signOut")}
                title={nav("signOut")}
              >
                <SignOutIcon />
              </Button>
            </form>
          </>
        ) : (
          <Button asChild size="sm">
            <a href="/auth/sign-in?returnTo=%2F">
              <SignInIcon />
              {nav("signIn")}
            </a>
          </Button>
        )}
      </div>
    </header>
  );
}
