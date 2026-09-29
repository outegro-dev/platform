import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";

/** Links every page owes its visitor: the site, privacy and the account. */
export async function AppFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="app-footer og-container">
      <a href={env.SITE_URL}>{t("site")}</a>
      <a href={new URL("/privacy", env.SITE_URL).toString()}>{t("privacy")}</a>
      <a href={new URL("/account", env.ID_URL).toString()}>{t("account")}</a>
      <span className="footer-note">{t("provider")}</span>
    </footer>
  );
}
