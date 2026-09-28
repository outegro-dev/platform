import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";

/** Links every account page owes its visitor: the site and its privacy policy. */
export async function AppFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="app-footer">
      <a href={env.SITE_URL}>{t("site")}</a>
      <a href={`${env.SITE_URL}/privacy`}>{t("privacy")}</a>
    </footer>
  );
}
