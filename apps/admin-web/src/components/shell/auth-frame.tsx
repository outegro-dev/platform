import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "./locale-switcher";

/** Frame for pages outside the console: sign-in, no access, outages. */
export async function AuthFrame({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  const t = await getTranslations("shell");
  return (
    <div className="auth-shell og-container">
      <header className="auth-head">
        <Link href="/" className="brand-home" aria-label={t("home")}>
          <span className="brand-word">outegro</span>
          <span className="og-eyebrow">{t("product")}</span>
        </Link>
        <div className="row-gap">
          <LocaleSwitcher />
          {actions}
        </div>
      </header>
      <main id="main" className="auth-body">
        {children}
      </main>
    </div>
  );
}
