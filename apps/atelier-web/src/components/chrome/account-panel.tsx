import { Button } from "@outegro/ui/button";
import { initialsOf } from "@outegro/ui/lib/platform";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import type { Viewer } from "@/lib/api";
import type { ThemeChoice } from "@/lib/theme";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeSwitch } from "./theme";

/**
 * Who is signed in, the language and theme, and sign-out: the foot of the
 * sidebar on a desktop, the menu sheet on a phone. (The platform's account
 * menu has no entry for Atelier yet, so this is the app's own.)
 */
export async function AccountPanel({
  viewer,
  mock,
  theme,
}: {
  viewer: Viewer;
  mock: boolean;
  theme: ThemeChoice;
}) {
  const t = await getTranslations("nav");
  const name = viewer.displayName || viewer.email || t("account");
  return (
    <div className="account">
      <div className="account-who">
        <span className="account-avatar" aria-hidden="true">
          {initialsOf(name) || "·"}
        </span>
        <span className="account-text">
          <span className="account-name">{name}</span>
          {mock ? (
            <span className="account-mock">
              <span className="mock-badge">{t("mock")}</span>
              <span className="account-hint">{t("mockHint")}</span>
            </span>
          ) : viewer.email && viewer.displayName ? (
            <span className="account-hint">{viewer.email}</span>
          ) : null}
        </span>
      </div>
      <div className="account-controls">
        <LocaleSwitcher />
        <ThemeSwitch initial={theme} />
      </div>
      {mock ? null : (
        <form method="post" action="/auth/sign-out">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="account-out"
          >
            <SignOutIcon aria-hidden="true" />
            {t("signOut")}
          </Button>
        </form>
      )}
    </div>
  );
}
