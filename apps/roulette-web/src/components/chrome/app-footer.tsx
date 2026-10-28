import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";

/** Links every page owes its visitor: the site, the account, the privacy policy. */
export async function AppFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="app-footer og-container">
      <a href={env.SITE_URL}>{t("site")}</a>
      <a href={env.ID_URL}>{t("account")}</a>
      <a href={`${env.SITE_URL}/privacy`}>{t("privacy")}</a>
    </footer>
  );
}
