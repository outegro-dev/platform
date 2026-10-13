import { Button } from "@outegro/ui/button";
import {
  ArrowDownIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata, Viewport } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ContactDialog } from "@/components/contact-dialog";
import { ContactLinks } from "@/components/contact-links";
import { Header } from "@/components/header";
import { RevealObserver } from "@/components/reveal-observer";
import { SectionHeading } from "@/components/section-heading";
import { SiteFooter } from "@/components/site-footer";
import { Dish } from "@/components/stack/dish";
import { TrumpCard } from "@/components/stack/trump-card";
import { StampMark } from "@/components/zine/bits";
import { generator, seed, tilt } from "@/components/zine/random";
import { Ransom } from "@/components/zine/ransom";
import { Stamp } from "@/components/zine/stamp";
import { calendly } from "@/lib/contact";
import { openGraph } from "@/lib/metadata";
import { sso } from "@/lib/sso";
import { menu, trumpDeck, trumpStats } from "@/lib/stack";
import "./stack.css";

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

// the main page's cream paper, which this page is printed on too (stack.css)
export const viewport: Viewport = { themeColor: "#f6eede" };

/** A seeded crooked angle per block, the same on every render. */
const crooked = (key: string, max: number) =>
  ({
    "--tilt": `${tilt(generator(seed(key)), max)}deg`,
  }) as React.CSSProperties;

const two = (n: number) => String(n).padStart(2, "0");

/**
 * Every technology of the platform as the menu of a harbour restaurant:
 * dishes grouped by job, each with a joke, what it really does in production
 * and where to taste it live; then the key ones as flip-over trading cards.
 */
export default async function Stack() {
  const t = await getTranslations("stackPage");
  const nav = await getTranslations("nav");
  const labels = {
    price: t("priceLabel"),
    fact: t("fact"),
    live: t("live"),
  };

  return (
    <>
      <Header accounts={sso !== null} />
      <main id="main" className="menu-page">
        <section
          className="menu-cover og-container"
          id="top"
          aria-labelledby="stack-title"
        >
          <div className="menu-cover-card">
            <span aria-hidden="true" className="tape menu-tape is-left" />
            <span aria-hidden="true" className="tape menu-tape is-right" />
            <p className="menu-kicker">{t("houseKicker")}</p>
            <p className="menu-house">{t("house")}</p>
            <p aria-hidden="true" className="menu-ornament">
              ✦ ✦ ✦
            </p>
            <h1 id="stack-title" className="menu-h1">
              <span className="menu-title">
                <Ransom text={t("title")} />
              </span>
              <span className="sr-only"> — </span>
              <span className="menu-subtitle">{t("titleAccent")}</span>
            </h1>
            <p className="menu-chef">{t("chef")}</p>
            <p className="menu-hours">{t("hours")}</p>
          </div>

          <div className="menu-cover-side">
            <p className="menu-intro">{t("intro")}</p>
            <nav className="menu-toc" aria-label={t("sectionsLabel")}>
              <ol>
                {menu.map((section, i) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>
                      <span className="menu-toc-no">{two(i + 1)}</span>
                      <span className="menu-toc-title">
                        {t(`sections.${section.id}.title`)}
                      </span>
                      <span aria-hidden="true" className="menu-toc-dots" />
                      <span className="menu-toc-kind">
                        {t(`sections.${section.id}.kind`)}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="menu-cover-foot">
              <p className="menu-to-deck">
                <a href="#trumps">
                  {t("trumps.jump")}
                  <ArrowDownIcon aria-hidden="true" />
                </a>
              </p>
              <Stamp text={t("stamp")} className="menu-cover-stamp" />
            </div>
          </div>
        </section>

        <div className="og-container">
          <div className="menu-card">
            <span aria-hidden="true" className="menu-stain" />
            {menu.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                className="menu-section"
                aria-labelledby={`${section.id}-title`}
              >
                <header className="menu-section-head" data-reveal>
                  <p aria-hidden="true" className="menu-section-no">
                    {two(i + 1)}
                  </p>
                  <h2 id={`${section.id}-title`}>
                    <span className="menu-section-title">
                      {t(`sections.${section.id}.title`)}
                    </span>
                    <span className="sr-only"> — </span>
                    <span className="menu-section-kind">
                      {t(`sections.${section.id}.kind`)}
                    </span>
                  </h2>
                  <p className="menu-section-lead">
                    {t(`sections.${section.id}.lead`)}
                  </p>
                  <p
                    className="menu-section-note"
                    style={crooked(section.id, 4)}
                  >
                    {t(`sections.${section.id}.note`)}
                  </p>
                </header>
                <ul className="menu-dishes">
                  {section.dishes.map((dish) => (
                    <Dish
                      key={dish.id}
                      name={dish.name ?? t(`names.${dish.id}`)}
                      price={t(`prices.${dish.price}`)}
                      joke={t(`jokes.${dish.id}`)}
                      fact={t(`items.${dish.id}`)}
                      links={dish.links}
                      labels={labels}
                    />
                  ))}
                </ul>
              </section>
            ))}
            <p className="menu-fine">{t("fine")}</p>
            <span aria-hidden="true" className="stamp menu-card-stamp">
              <StampMark text={t("qc")} tone="blue" />
            </span>
          </div>
        </div>

        <section
          className="trumps section-space og-container"
          id="trumps"
          aria-labelledby="trumps-title"
        >
          <SectionHeading
            id="trumps-title"
            index={t("trumps.index")}
            label={t("trumps.label")}
            title={t("trumps.title")}
            accent={t("trumps.titleAccent")}
          />
          <div className="trumps-rules" data-reveal>
            <p>{t("trumps.rules")}</p>
            <p className="trumps-hint">{t("trumps.hint")}</p>
          </div>
          <ul className="trumps-deck">
            {trumpDeck.map((card, i) => (
              <li key={card.id} style={crooked(card.id, 2.2)}>
                <TrumpCard
                  number={t("trumps.number", { n: two(i + 1) })}
                  name={card.name}
                  role={t(`trumps.cards.${card.id}.role`)}
                  tone={card.tone}
                  stats={trumpStats.map((stat) => ({
                    key: stat,
                    label: t(`trumps.stats.${stat}`),
                    value: card.stats[stat],
                  }))}
                  factLabel={t("fact")}
                  fact={t(`trumps.cards.${card.id}.does`)}
                  weakLabel={t("trumps.weak")}
                  weak={t(`trumps.cards.${card.id}.weak`)}
                  flip={t("trumps.flip")}
                />
              </li>
            ))}
          </ul>
          <p className="trumps-note">{t("trumps.note")}</p>
        </section>

        <section
          className="menu-cta og-container"
          aria-labelledby="stack-cta-title"
        >
          <div className="menu-compliment" data-reveal>
            <p className="menu-compliment-kicker">{t("cta.kicker")}</p>
            <h2 id="stack-cta-title">{t("cta.title")}</h2>
            <p className="menu-compliment-body">{t("cta.body")}</p>
            <div className="menu-cta-actions">
              <Button asChild size="lg">
                <a
                  href={calendly}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-describedby="stack-book-hint"
                >
                  {nav("book")}
                  <ArrowUpRightIcon aria-hidden="true" />
                </a>
              </Button>
              <ContactDialog variant="outline">
                <ContactLinks compact />
              </ContactDialog>
              <Button asChild size="lg" variant="outline">
                <a href="/#projects">{t("cta.work")}</a>
              </Button>
            </div>
            <p id="stack-book-hint" className="menu-cta-hint">
              {nav("bookHint")}
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
      <RevealObserver />
    </>
  );
}
