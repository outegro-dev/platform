import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { platformLinks } from "@/lib/platform";
import { LocaleSwitcher } from "./locale-switcher";

/** Footer of every landing page; `#top` must exist on the page. */
export async function SiteFooter() {
  const t = await getTranslations("footer");
  const zine = await getTranslations("zine");
  return (
    <footer className="site-footer og-container">
      <div className="footer-brand">
        <a href="/#top" className="footer-name">
          Nick Lukashik
        </a>
        <span className="og-eyebrow">{t("role")}</span>
      </div>
      <nav className="footer-nav" aria-labelledby="footer-platform">
        <h2 id="footer-platform" className="og-eyebrow">
          {t("platform")}
        </h2>
        <ul>
          {platformLinks.map((link) => (
            <li key={link.key}>
              <a href={link.href} className="footer-link">
                {t(`links.${link.key}`)}
                <span className="footer-host">{link.host}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <nav className="footer-nav" aria-labelledby="footer-site">
        <h2 id="footer-site" className="og-eyebrow">
          {t("site")}
        </h2>
        <ul>
          <li>
            <a href="/stack" className="footer-link">
              {t("stack")}
            </a>
          </li>
          <li>
            <a href="/privacy" className="footer-link">
              {t("privacy")}
            </a>
          </li>
        </ul>
      </nav>
      <p className="footer-imprint">{zine("imprint")}</p>
      <div className="footer-bottom">
        <LocaleSwitcher />
        <span className="og-eyebrow">© {new Date().getFullYear()}</span>
        <a href="#top" className="footer-top">
          {t("back")}
          <ArrowUpIcon />
        </a>
      </div>
    </footer>
  );
}
