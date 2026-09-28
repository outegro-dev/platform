import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooter } from "@/components/site-footer";
import { contacts } from "@/lib/contact";

type Section = { title: string; items: string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/privacy" },
  };
}

/** Plain-language privacy notice; Google sign-in and payments link here. */
export default async function Privacy() {
  const t = await getTranslations("privacy");
  const sections = t.raw("sections") as Section[];
  const email = contacts.find((contact) => contact.key === "email");
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
        {email && (
          <section className="legal-section">
            <h2>{t("contact")}</h2>
            <p>
              <a href={email.href} className="legal-mail">
                {email.handle}
              </a>
            </p>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
