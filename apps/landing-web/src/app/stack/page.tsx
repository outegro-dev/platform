import { Button } from "@outegro/ui/button";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ContactDialog } from "@/components/contact-dialog";
import { ContactLinks } from "@/components/contact-links";
import { Header } from "@/components/header";
import { RevealObserver } from "@/components/reveal-observer";
import { SiteFooter } from "@/components/site-footer";
import { Ransom } from "@/components/zine/ransom";
import { openGraph } from "@/lib/metadata";
import { stackGroups } from "@/lib/stack";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("stackPage.meta");
  const page = {
    title: t("title"),
    description: t("description"),
    url: "/stack",
  };
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.url },
    openGraph: openGraph(await getLocale(), page),
  };
}

/** Every technology of the platform, grouped by job, with where it runs. */
export default async function Stack() {
  const t = await getTranslations("stackPage");
  return (
    <>
      <Header page="stack" />
      <main id="main">
        <section
          className="stack-hero og-container"
          id="top"
          aria-labelledby="stack-title"
        >
          <p className="og-eyebrow section-index">
            <span>{t("eyebrow")}</span>
            <span aria-hidden="true" className="section-rule" />
            <span>outegro.dev</span>
          </p>
          <h1 id="stack-title">
            <span>{t("title")}</span>{" "}
            <span className="og-accent">{t("titleAccent")}</span>
          </h1>
          <p className="stack-intro">{t("intro")}</p>
          <nav className="stack-toc" aria-label={t("groupsLabel")}>
            <ol>
              {stackGroups.map((group, i) => (
                <li key={group.id}>
                  <a href={`#${group.id}`}>
                    <span className="og-eyebrow">0{i + 1}</span>
                    {t(`groups.${group.id}.title`)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </section>

        <div className="og-container">
          <p className="stack-ransom" aria-hidden="true">
            <Ransom text={t("titleAccent")} />
          </p>
        </div>

        <div className="stack-groups og-container">
          {stackGroups.map((group, i) => (
            <section
              key={group.id}
              id={group.id}
              className="stack-group"
              aria-labelledby={`${group.id}-title`}
            >
              <div className="stack-group-head" data-reveal>
                <p className="og-eyebrow">0{i + 1}</p>
                <h2 id={`${group.id}-title`}>
                  {t(`groups.${group.id}.title`)}
                </h2>
                <p>{t(`groups.${group.id}.lead`)}</p>
              </div>
              <ul className="stack-items">
                {group.items.map((item) => (
                  <li key={item.id} className="stack-item" data-reveal>
                    <h3>{item.name ?? t(`names.${item.id}`)}</h3>
                    <div>
                      <p>{t(`items.${item.id}`)}</p>
                      {item.links ? (
                        <p className="stack-live">
                          <span className="og-eyebrow">{t("live")}</span>
                          {item.links.map((link) => (
                            <a key={link.href} href={link.href}>
                              {link.label}
                            </a>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section
          className="stack-cta og-container"
          aria-labelledby="stack-cta-title"
          data-reveal
        >
          <h2 id="stack-cta-title">{t("cta.title")}</h2>
          <p>{t("cta.body")}</p>
          <div className="stack-cta-actions">
            <ContactDialog variant="primary" label={t("cta.button")}>
              <ContactLinks compact />
            </ContactDialog>
            <Button asChild size="lg" variant="outline">
              <a href="/#projects">{t("cta.work")}</a>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
      <RevealObserver />
    </>
  );
}
