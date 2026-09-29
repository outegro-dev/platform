import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  BookOpenTextIcon,
  GitBranchIcon,
  HandshakeIcon,
  ListChecksIcon,
  PulseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import knotPoster from "@/assets/knot.webp";
import signaturePoster from "@/assets/signature.webp";
import { ContactDialog } from "@/components/contact-dialog";
import { ContactLinks } from "@/components/contact-links";
import { Header } from "@/components/header";
import { ProjectShowcase } from "@/components/project-showcase";
import { RevealObserver } from "@/components/reveal-observer";
import { SectionHeading } from "@/components/section-heading";
import { SilverStage } from "@/components/silver/silver-stage";
import { SiteFooter } from "@/components/site-footer";
import { TurnkeyStrip } from "@/components/turnkey-strip";

type Layer = {
  name: string;
  items: { name: string; result: string; tech: string }[];
};
type Service = {
  title: string;
  body: string;
  stack: string[];
  proof: string;
  href?: string;
};
type Step = { title: string; body: string; see: string };
type Point = { title: string; body: string };

// Hosts of the running platform, shown as proof in the Platform section.
const hosts = [
  "outegro.dev",
  "id.outegro.dev",
  "battleship.outegro.dev",
  "pay.outegro.dev",
  "admin.outegro.dev",
];
// One icon per deliverable, in the order of engagement.deliverables.
const deliverableIcons = [
  GitBranchIcon,
  ListChecksIcon,
  BookOpenTextIcon,
  ArrowsClockwiseIcon,
  PulseIcon,
  HandshakeIcon,
];
const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties;

export default async function Home() {
  const t = await getTranslations();
  const layers = t.raw("platform.layers") as Layer[];
  const services = t.raw("services.items") as Service[];
  const steps = t.raw("process.steps") as Step[];
  const deliverables = t.raw("engagement.deliverables") as Point[];
  const formats = t.raw("engagement.formats") as Point[];

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
                <a href="#projects">
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

        <TurnkeyStrip />

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
          <ProjectShowcase />
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
            <div className="platform-intro" data-reveal>
              <p>{t("platform.intro")}</p>
              <div className="platform-live">
                <p className="live-status">
                  <span className="live-dot" aria-hidden="true" />
                  {t("platform.live")}
                </p>
                <ul className="platform-hosts">
                  {hosts.map((host) => (
                    <li key={host}>{host}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="platform-grid">
              {layers.map((layer, i) => (
                <div
                  key={layer.name}
                  className="platform-layer"
                  data-reveal
                  style={delay(i * 110)}
                >
                  <h3 className="og-eyebrow">
                    <span>0{i + 1}</span> {layer.name}
                  </h3>
                  <ul>
                    {layer.items.map((item) => (
                      <li key={item.name} className="platform-node">
                        <h4>{item.name}</h4>
                        <p>{item.result}</p>
                        <p className="platform-node-tech">{item.tech}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="services"
          className="services og-container section-space"
          aria-labelledby="services-title"
        >
          <SectionHeading
            id="services-title"
            index={t("services.index")}
            label={t("services.label")}
            title={t("services.title")}
            accent={t("services.titleAccent")}
          />
          <div className="services-layout">
            <div className="services-aside" data-reveal>
              <p className="services-intro">{t("services.intro")}</p>
              <SilverStage
                kind="knot"
                className="services-art"
                poster={knotPoster}
                alt={t("services.art")}
                sizes="(max-width: 767px) 90vw, 36vw"
              />
            </div>
            <ol className="services-list">
              {services.map((item, i) => (
                <li key={item.title} className="service" data-reveal>
                  <span className="og-eyebrow service-number">0{i + 1}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <ul className="badge-list">
                      {item.stack.map((tech) => (
                        <li key={tech}>
                          <Badge>{tech}</Badge>
                        </li>
                      ))}
                    </ul>
                    <p className="og-eyebrow service-proof">
                      {item.href ? (
                        <a href={item.href}>{item.proof}</a>
                      ) : (
                        item.proof
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="process"
          className="process og-container section-space"
          aria-labelledby="process-title"
        >
          <SectionHeading
            id="process-title"
            index={t("process.index")}
            label={t("process.label")}
            title={t("process.title")}
            accent={t("process.titleAccent")}
          />
          <p className="section-lead" data-reveal>
            {t("process.intro")}
          </p>
          <ol className="process-steps">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className="process-step"
                data-reveal
                style={delay(i * 70)}
              >
                <span className="process-number" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="process-what">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
                <div className="process-see">
                  <p className="og-eyebrow">{t("process.youSee")}</p>
                  <p>{step.see}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="process-ai" data-reveal>
            {t("process.ai")}
          </p>
        </section>

        <section
          id="engagement"
          className="engagement og-container section-space"
          aria-labelledby="engagement-title"
        >
          <SectionHeading
            id="engagement-title"
            index={t("engagement.index")}
            label={t("engagement.label")}
            title={t("engagement.title")}
            accent={t("engagement.titleAccent")}
          />
          <div className="engagement-block">
            <h3 className="engagement-subtitle" data-reveal>
              {t("engagement.deliverablesTitle")}
            </h3>
            <ul className="deliverables">
              {deliverables.map((item, i) => {
                const Icon = deliverableIcons[i] ?? ListChecksIcon;
                return (
                  <li key={item.title} data-reveal style={delay(i * 60)}>
                    <Icon className="deliverable-icon" aria-hidden="true" />
                    <h4>{item.title}</h4>
                    <p>{item.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="engagement-block">
            <h3 className="engagement-subtitle" data-reveal>
              {t("engagement.formatsTitle")}
            </h3>
            <ol className="formats">
              {formats.map((item, i) => (
                <li
                  key={item.title}
                  className="format"
                  data-reveal
                  style={delay(i * 90)}
                >
                  <span className="format-number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="engagement-cta" data-reveal>
            <ContactDialog variant="primary" label={t("engagement.cta")}>
              <ContactLinks compact />
            </ContactDialog>
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
