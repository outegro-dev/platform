import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { CONSENT_COOKIE, parseConsent } from "@/components/consent/consent";
import { ConsentSettings } from "@/components/consent/consent-settings";
import { EmailAddress, EmailLink } from "@/components/email-link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooter } from "@/components/site-footer";
import { env } from "@/lib/env";
import { openGraph } from "@/lib/metadata";

type Section = { title: string; items: string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy.meta");
  const page = {
    title: t("title"),
    description: t("description"),
    url: "/privacy",
  };
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.url },
    openGraph: openGraph(await getLocale(), page),
  };
}

/**
 * Plain-language privacy notice; Google sign-in and payments link here, and
 * the consent note links to its #analytics settings.
 */
export default async function Privacy() {
  const t = await getTranslations("privacy");
  const sections = t.raw("sections") as Section[];
  const consent = parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);
  return (
    <>
      <main id="main" className="legal og-container">
        <div className="legal-top" id="top">
          <a href="/" className="legal-back">
            <ArrowLeftIcon aria-hidden="true" />
            {t("back")}
          </a>
          <LocaleSwitcher />
        </div>
        <header className="legal-head">
          <p className="og-eyebrow">{t("eyebrow")}</p>
          <h1>
            {t("title")} <span className="og-accent">{t("titleAccent")}</span>
          </h1>
          <p className="legal-intro">{t("intro")}</p>
          <p className="og-eyebrow">{t("updated")}</p>
        </header>
        {sections.map((section) => (
          <section key={section.title} className="legal-section">
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <section
          className="legal-section"
          id="analytics"
          aria-labelledby="analytics-title"
        >
          <h2 id="analytics-title">{t("analytics.title")}</h2>
          {/* nothing to choose until the owner turns statistics on */}
          {env.GTM_ID ? (
            <ConsentSettings initial={consent} />
          ) : (
            <p className="consent-settings-state">{t("analytics.off")}</p>
          )}
        </section>
        <section className="legal-section">
          <h2>{t("contact")}</h2>
          <p>
            <EmailLink className="legal-mail">
              <EmailAddress />
            </EmailLink>
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
