import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import knotPoster from "@/assets/knot.webp";
import signaturePoster from "@/assets/signature.webp";
import wavePoster from "@/assets/wave.webp";
import { ContactDialog } from "@/components/contact-dialog";
import { ContactLinks } from "@/components/contact-links";
import { Header } from "@/components/header";
import { RevealObserver } from "@/components/reveal-observer";
import { SectionHeading } from "@/components/section-heading";
import { SilverStage } from "@/components/silver/silver-stage";
import { SiteFooter } from "@/components/site-footer";
import { StackMarquee } from "@/components/stack-marquee";

type Expertise = {
  title: string;
  body: string;
  stack: string[];
  focus: string;
};
type Point = { title: string; body: string };
type Layer = {
  name: string;
  items: { name: string; tech: string; status: "ready" | "building" }[];
};

export default async function Home() {
  const t = await getTranslations();
  const expertise = t.raw("expertise.items") as Expertise[];
  const approach = t.raw("approach.items") as Point[];
  const layers = t.raw("platform.layers") as Layer[];

  return (
    <>
      <Header />
      <main id="main">
        <section
          className="hero og-container"
          id="top"
          aria-labelledby="hero-title"
        >
          <div className="hero-copy">
            <p className="og-eyebrow hero-eyebrow">{t("hero.eyebrow")}</p>
            <h1 id="hero-title">
              <span className="hero-line">{t("hero.line1")}</span>{" "}
              <span className="hero-line og-accent">{t("hero.line2")}</span>
            </h1>
            <p className="hero-description">{t("hero.description")}</p>
            <div className="hero-actions">
              <Button asChild size="lg" className="hero-cta">
                <a href="#expertise">
                  {t("hero.cta")}
                  <ArrowDownIcon />
                </a>
              </Button>
              <ContactDialog variant="outline" label={t("hero.contact")}>
                <ContactLinks compact />
              </ContactDialog>
            </div>
          </div>
          <SilverStage
            kind="signature"
            className="hero-art"
            poster={signaturePoster}
            alt={t("hero.art")}
            sizes="(max-width: 767px) 110vw, 60vw"
            priority
          />
          <div className="hero-foot" aria-hidden="true">
            <span className="og-eyebrow">outegro.dev</span>
            <span className="og-eyebrow hero-scroll">
              {t("hero.scroll")}
              <span className="hero-scroll-line" />
            </span>
          </div>
        </section>

        <StackMarquee />

        <section
          id="expertise"
          className="expertise og-container section-space"
          aria-labelledby="expertise-title"
        >
          <SectionHeading
            id="expertise-title"
            index={t("expertise.index")}
            label={t("expertise.label")}
            title={t("expertise.title")}
            accent={t("expertise.titleAccent")}
          />
          <div className="expertise-layout">
            <div className="expertise-aside" data-reveal>
              <p className="expertise-intro">{t("expertise.intro")}</p>
              <SilverStage
                kind="knot"
                className="expertise-art"
                poster={knotPoster}
                alt={t("expertise.art")}
                sizes="(max-width: 767px) 90vw, 36vw"
              />
            </div>
            <ol className="expertise-list">
              {expertise.map((item, i) => (
                <li key={item.title} className="expertise-item" data-reveal>
                  <span className="og-eyebrow expertise-number">0{i + 1}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <ul className="expertise-stack">
                      {item.stack.map((tech) => (
                        <li key={tech}>
                          <Badge>{tech}</Badge>
                        </li>
                      ))}
                    </ul>
                    <p className="og-eyebrow expertise-focus">{item.focus}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="approach"
          className="approach og-container section-space"
          aria-labelledby="approach-title"
        >
          <SectionHeading
            id="approach-title"
            index={t("approach.index")}
            label={t("approach.label")}
            title={t("approach.title")}
            accent={t("approach.titleAccent")}
          />
          <ol className="approach-points">
            {approach.map((item, i) => (
              <li
                key={item.title}
                data-reveal
                style={
                  { "--reveal-delay": `${i * 90}ms` } as React.CSSProperties
                }
              >
                <span className="approach-number" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="platform"
          className="platform"
          data-tone="dark"
          aria-labelledby="platform-title"
        >
          <div className="og-container section-space">
            <SectionHeading
              id="platform-title"
              index={t("platform.index")}
              label={t("platform.label")}
              title={t("platform.title")}
              accent={t("platform.titleAccent")}
            />
            <p className="platform-intro" data-reveal>
              {t("platform.intro")}
            </p>
            <div className="platform-grid">
              {layers.map((layer, i) => (
                <div
                  key={layer.name}
                  className="platform-layer"
                  data-reveal
                  style={
                    { "--reveal-delay": `${i * 110}ms` } as React.CSSProperties
                  }
                >
                  <h3 className="og-eyebrow">
                    <span>0{i + 1}</span> {layer.name}
                  </h3>
                  <ul>
                    {layer.items.map((item) => (
                      <li
                        key={item.name}
                        className="platform-node"
                        data-status={item.status}
                      >
                        <span className="platform-node-name">{item.name}</span>
                        <span className="platform-node-tech">{item.tech}</span>
                        <span className="platform-node-status">
                          <span className="status-dot" aria-hidden="true" />
                          {t(`platform.${item.status}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="projects"
          className="projects og-container section-space"
          aria-labelledby="projects-title"
        >
          <SectionHeading
            id="projects-title"
            index={t("projects.index")}
            label={t("projects.label")}
            title={t("projects.title")}
            accent={t("projects.titleAccent")}
          />
          <div className="project-card" data-reveal>
            <SilverStage
              kind="wave"
              className="project-art"
              poster={wavePoster}
              alt={t("projects.art")}
              sizes="(max-width: 1488px) 100vw, 1488px"
            />
            <div className="project-caption">
              <div>
                <h3>{t("projects.name")}</h3>
                <p>{t("projects.description")}</p>
              </div>
              <div className="project-actions">
                <Badge variant="glass">{t("projects.status")}</Badge>
                <Button asChild size="sm">
                  <a href="https://battleship.outegro.dev">
                    {t("projects.cta")}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section
          id="contact"
          className="contact og-container section-space"
          aria-labelledby="contact-title"
        >
          <SectionHeading
            id="contact-title"
            index={t("contact.index")}
            label={t("contact.label")}
            title={t("contact.title")}
            accent={t("contact.titleAccent")}
          />
          <div className="contact-layout" data-reveal>
            <div>
              <p className="contact-description">{t("contact.description")}</p>
              <p className="og-eyebrow contact-where">
                {t("contact.location")}
              </p>
            </div>
            <ContactLinks />
          </div>
        </section>
      </main>
      <SiteFooter />
      <RevealObserver />
    </>
  );
}
