import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import cover from "@/assets/zine/cover.webp";
import { BoatBar } from "@/components/boat/boat-bar";
import { BonkRetry } from "@/components/bonk/bonk-retry";
import { ContactDialog } from "@/components/contact-dialog";
import { ContactLinks } from "@/components/contact-links";
import { Header } from "@/components/header";
import { PaperJourney } from "@/components/paper/paper-journey";
import { ProjectShowcase } from "@/components/project-showcase";
import { RevealObserver } from "@/components/reveal-observer";
import { SectionHeading } from "@/components/section-heading";
import { SiteFooter } from "@/components/site-footer";
import { Barcode, PriceTag, Ticker } from "@/components/zine/bits";
import { CatPaw } from "@/components/zine/cat-paw";
import { Coupon } from "@/components/zine/coupon";
import { DontPress } from "@/components/zine/dont-press";
import { Fly } from "@/components/zine/fly";
import { Mischief } from "@/components/zine/mischief";
import { generator, seed, tilt } from "@/components/zine/random";
import { Ransom } from "@/components/zine/ransom";
import { Receipt } from "@/components/zine/receipt";
import { Stamp } from "@/components/zine/stamp";
import { TearOffs } from "@/components/zine/tear-offs";
import { contacts } from "@/lib/contact";

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
type Coverline = { kicker: string; text: string; page: string };
type TocItem = { title: string; href: string; page: string };

// Hosts of the running platform, shown as proof in the Platform section.
const hosts = [
  "outegro.dev",
  "id.outegro.dev",
  "battleship.outegro.dev",
  "pay.outegro.dev",
  "admin.outegro.dev",
  "edu.outegro.dev",
];
const telegram = contacts.find((c) => c.key === "telegram") ?? contacts[0];
/** A seeded crooked angle per block, the same on every render. */
const crooked = (key: string, max = 2.4) =>
  ({
    "--tilt": `${tilt(generator(seed(key)), max)}deg`,
  }) as React.CSSProperties;

export default async function Home() {
  const t = await getTranslations();
  const layers = t.raw("platform.layers") as Layer[];
  const services = t.raw("services.items") as Service[];
  const steps = t.raw("process.steps") as Step[];
  const deliverables = t.raw("engagement.deliverables") as Point[];
  const formats = t.raw("engagement.formats") as Point[];
  const coverlines = t.raw("zine.coverlines") as Coverline[];
  const toc = t.raw("zine.toc") as TocItem[];
  const ticker = t.raw("zine.ticker") as string[];
  const tags = t.raw("zine.tags") as string[];
  const pageHref = (page: string) =>
    toc.find((item) => item.page === page)?.href ?? "#projects";

  return (
    <>
      <Header />
      <main id="main">
        <section
          className="cover og-container"
          id="top"
          aria-labelledby="hero-title"
        >
          <p className="cover-strip">
            <span>{t("zine.issue")}</span>
            <span>{t("zine.price")}</span>
          </p>
          <p className="cover-mast" aria-hidden="true">
            {t("zine.mast")}
          </p>
          <p className="cover-tagline">{t("zine.tagline")}</p>

          <div className="cover-grid">
            <div className="cover-copy">
              <h1 id="hero-title" className="cover-headline">
                <Ransom text={t("zine.headline")} />
              </h1>
              <p className="cover-lead">{t("zine.lead")}</p>
              <ul className="coverlines">
                {coverlines.map((line) => (
                  <li key={line.text} style={crooked(line.text, 1.6)}>
                    <a href={pageHref(line.page)}>
                      <span className="coverline-kicker">{line.kicker}</span>
                      <span className="coverline-text">{line.text}</span>
                      <span className="coverline-page">{line.page}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <div className="cover-actions">
                <Button asChild size="lg">
                  <a href="#projects">
                    {t("zine.read")}
                    <ArrowDownIcon />
                  </a>
                </Button>
                <ContactDialog variant="outline" label={t("zine.write")}>
                  <ContactLinks compact />
                </ContactDialog>
              </div>
            </div>

            <figure className="cover-art">
              <Image
                src={cover}
                alt={t("zine.coverAlt")}
                sizes="(max-width: 767px) 92vw, 44vw"
                preload
                fetchPriority="high"
                quality={75}
                placeholder="empty"
              />
              <span className="tape is-top" aria-hidden="true" />
              <span className="tape is-bottom" aria-hidden="true" />
              <p className="burst">
                <b>{t("zine.burst")}</b>
                <span>{t("zine.burstText")}</span>
              </p>
              <PriceTag
                className="cover-tag"
                price={t("zine.tagPrice")}
                note={t("zine.tagNote")}
              />
              <Barcode code="4 607001 770011" />
            </figure>
          </div>
        </section>

        <Ticker label={t("zine.tickerLabel")} items={ticker} />

        <nav className="toc og-container" aria-labelledby="toc-title">
          <h2 id="toc-title" className="toc-title">
            {t("zine.tocTitle")}
          </h2>
          <ol>
            {toc.map((item) => (
              <li key={item.href}>
                <a href={item.href}>
                  <span className="toc-name">{item.title}</span>
                  <span className="toc-dots" aria-hidden="true" />
                  <span className="toc-page">{item.page}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

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
          <div className="stamped">
            <ProjectShowcase />
            <Stamp text={t("zine.stampLive")} className="project-stamp" />
          </div>
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
            <BonkRetry>
              <div className="platform-grid">
                {layers.map((layer, i) => (
                  <div
                    key={layer.name}
                    className="platform-layer"
                    style={crooked(layer.name, 1.2)}
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
            </BonkRetry>
            <DontPress
              labels={
                t.raw("zine.dontPress") as React.ComponentProps<
                  typeof DontPress
                >["labels"]
              }
            />
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
            label={t("zine.adsTitle")}
            title={t("services.title")}
            accent={t("services.titleAccent")}
          />
          <p className="section-lead" data-reveal>
            {t("services.intro")}
          </p>
          <p className="ads-note">{t("zine.adsNote")}</p>
          <ol className="ads">
            {services.map((item, i) => (
              <li
                key={item.title}
                className={`ad is-${i % 3}`}
                style={crooked(item.title, 2.2)}
              >
                <h3 className="ad-title">{item.title}</h3>
                <p className="ad-body">{item.body}</p>
                <ul className="badge-list">
                  {item.stack.map((tech) => (
                    <li key={tech}>
                      <Badge>{tech}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="ad-proof">
                  {item.href ? (
                    <a href={item.href}>{item.proof}</a>
                  ) : (
                    item.proof
                  )}
                </p>
                <TearOffs
                  href={telegram.href}
                  handle={telegram.handle}
                  label={t("zine.adTear")}
                />
              </li>
            ))}
          </ol>
        </section>

        <section
          id="process"
          className="process section-space"
          aria-labelledby="process-title"
        >
          <div className="og-container">
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
          </div>
          {/* the steps as a scroll-driven paper cartoon (React Three Fiber) */}
          <PaperJourney
            steps={steps}
            labels={{ youSee: t("process.youSee") }}
          />
          <p className="process-ai og-container" data-reveal>
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
            label={t("zine.tagsTitle")}
            title={t("engagement.title")}
            accent={t("engagement.titleAccent")}
          />
          <h3 className="engagement-subtitle">
            {t("engagement.formatsTitle")}
          </h3>
          <CatPaw>
            <ol className="price-tags">
              {formats.map((item, i) => (
                <li key={item.title} style={crooked(item.title, 3.5)}>
                  <PriceTag price={tags[i] ?? ""} was={t("zine.tagWas")}>
                    <h4 className="price-title">{item.title}</h4>
                    <p className="price-body">{item.body}</p>
                  </PriceTag>
                </li>
              ))}
            </ol>
          </CatPaw>
          <p className="tags-note">{t("zine.tagsNote")}</p>

          <h3 className="engagement-subtitle">
            {t("engagement.deliverablesTitle")}
          </h3>
          <Receipt
            title={t("zine.receiptTitle")}
            number={t("zine.receiptNumber")}
            items={deliverables}
            included={t("zine.receiptIncluded")}
            total={t("zine.receiptTotal")}
            totalValue={t("zine.receiptTotalValue")}
            thanks={t("zine.receiptThanks")}
            stamp={t("zine.stampPaid")}
          />
          <div className="engagement-cta">
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
          <p className="section-lead">{t("contact.description")}</p>
          <Coupon
            title={t("zine.couponTitle")}
            offer={t("zine.couponOffer")}
            fine={t("zine.couponFine")}
            cut={t("zine.couponCut")}
            done={t("zine.couponCut2")}
          >
            <ContactLinks />
            <p className="og-eyebrow contact-where">{t("contact.location")}</p>
          </Coupon>
        </section>
      </main>
      <SiteFooter />
      <RevealObserver />
      <BoatBar label={t("zine.boatLabel")} stops={toc} />
      <Fly gone={t("zine.flyGone")} />
      <Mischief note={t("zine.consoleNote")} />
    </>
  );
}
