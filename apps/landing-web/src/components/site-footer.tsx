import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "./locale-switcher";

/** Footer of every landing page; `#top` must exist on the page. */
export async function SiteFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="site-footer og-container">
      <a href="/#top" className="footer-name">
        Nick Lukashik
      </a>
      <span className="og-eyebrow">{t("role")}</span>
      <LocaleSwitcher />
      <a href="/privacy" className="footer-link">
        {t("privacy")}
      </a>
      <span className="og-eyebrow">© {new Date().getFullYear()}</span>
      <a href="#top" className="footer-top">
        {t("back")}
        <ArrowUpIcon />
      </a>
    </footer>
  );
}
