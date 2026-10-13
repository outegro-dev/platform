import { Button } from "@outegro/ui/button";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { Viewport } from "next";
import Image, { getImageProps } from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { preload } from "react-dom";
import cutEn from "@/assets/cover/cut-en.webp";
import cutRu from "@/assets/cover/cut-ru.webp";
import magazine from "@/assets/cover/magazine.webp";
import scrap from "@/assets/cover/scrap.webp";
import strip from "@/assets/cover/strip.webp";
import { ContactLinks } from "@/components/contact-links";
import { Os } from "@/components/desktop/os";
import { Header } from "@/components/header";
import { RevealObserver } from "@/components/reveal-observer";
import { SectionHeading } from "@/components/section-heading";
import { SiteFooter } from "@/components/site-footer";
import { CatPaw } from "@/components/zine/cat-paw";
import { Coupon } from "@/components/zine/coupon";
import { Fly } from "@/components/zine/fly";
import { Issue } from "@/components/zine/issue";
import { LateFaces } from "@/components/zine/late-faces";
import { Mischief } from "@/components/zine/mischief";
import { calendly, contacts } from "@/lib/contact";
import { sso } from "@/lib/sso";

// the vintage cover's cream paper, which runs down the whole page; the
// other pages keep the zine paper of the layout
export const viewport: Viewport = { themeColor: "#f6eede" };

type TocItem = { title: string; href: string; page: string };

// a phone has the magazine a little wider than the screen (zine-page.css)
const magazineSizes =
  "(max-width: 767px) calc(100vw + 24px), (max-aspect-ratio: 4/5) 48vw, 54vw";

export default async function Home() {
  // the magazine is a wide cover's largest paint: there it is fetched first.
  // A phone (and an upright tablet, where it lies small) keeps the image's
  // own preload: raised there, it held the rest of the first screen back
  const { props: magazineProps } = getImageProps({
    src: magazine,
    alt: "",
    sizes: magazineSizes,
  });
  preload(magazineProps.src, {
    as: "image",
    imageSrcSet: magazineProps.srcSet,
    imageSizes: "(max-aspect-ratio: 4/5) 48vw, 54vw",
    fetchPriority: "high",
    media: "(min-width: 768px) and (min-aspect-ratio: 4/5)",
  });
  const t = await getTranslations();
  const toc = t.raw("zine.toc") as TocItem[];
  const steps = t.raw("zine.band.steps") as string[];
  const lede = t.raw("zine.lede") as string[];
  // "Discuss a project" opens a chat with the owner in Telegram
  const telegram = contacts.find((c) => c.key === "telegram")?.href;
  const locale = await getLocale();
  // The main call to action everywhere on the page: a 30-minute Calendly slot.
  const bookCall = () => (
    <Button asChild size="lg">
      <a href={calendly} target="_blank" rel="noopener noreferrer">
        {t("nav.book")}
        <ArrowUpRightIcon aria-hidden="true" />
      </a>
    </Button>
  );

  return (
    <>
      <Header home accounts={sso !== null} />
      <main id="main">
        <section className="cover" id="top" aria-labelledby="hero-title">
          {/* printing ink: the headline's edges a little rough, a few specks
              of paper showing through */}
          <svg className="sr-only" aria-hidden="true" focusable="false">
            <filter id="cover-ink">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.8"
                numOctaves="3"
                seed="7"
                result="grain"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="grain"
                scale="2"
                xChannelSelector="R"
                yChannelSelector="G"
                result="rough"
              />
              <feColorMatrix
                in="grain"
                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 18 -13.6"
                result="specks"
              />
              <feComposite in="rough" in2="specks" operator="out" />
            </filter>
          </svg>
          <div className="cover-copy og-container">
            <h1 id="hero-title" className="cover-headline">
              <span className="cover-lead">{t("zine.headlineLead")}</span>{" "}
              <span className="sr-only">{t("zine.headlineCut")}</span>
              {/* the end cut out of magazines, a picture in each language;
                  a tablet held upright has its own cover (zine-page.css,
                  the cut across the column there), the pictures sized for
                  it next to the phone's */}
              <Image
                src={locale === "ru" ? cutRu : cutEn}
                alt=""
                className="cover-cut"
                sizes="(max-width: 767px) 90vw, (max-aspect-ratio: 4/5) 91vw, 46vw"
                preload
              />
            </h1>
            <p className="cover-lede">
              {lede.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
            <div className="cover-actions">
              <a className="cover-button is-red" href="#projects">
                {t("zine.explore")}
                <ArrowUpRightIcon aria-hidden="true" />
              </a>
              <a
                className="cover-button"
                href={telegram}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("zine.discuss")}
              </a>
            </div>
          </div>

          {/* the magazine lying on the page, its cover marked for the book
              that flies off it (IssueFlight) */}
          <div className="cover-mag">
            <Image
              src={magazine}
              alt={t("zine.coverAlt")}
              sizes={magazineSizes}
              preload
            />
            <span className="cover-art" aria-hidden="true" />
          </div>

          {/* the torn strip: the way of the work, and where it ends. A phone
              fills a band of a fixed height with it, some 760px of the
              picture whatever the screen's width */}
          <div className="cover-band">
            <Image
              src={strip}
              alt=""
              className="cover-strip"
              sizes="(max-width: 767px) 760px, (max-aspect-ratio: 4/5) 88vw, 66vw"
            />
            <Image src={scrap} alt="" className="cover-scrap" sizes="7vw" />
            <div className="cover-band-inner og-container">
              <ol className="cover-steps">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <Issue toc={toc} />

        <Os />

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
          {/* the coupon and the booked call on the left; every other way to
              write on the right, from the lead's height down */}
          <div className="contact-grid">
            <div className="contact-main">
              <p className="section-lead">{t("contact.description")}</p>
              {/* the paw sets the coupon straight as soon as the e-mail line shows */}
              <CatPaw cue=".contact-side .contact-links > li:first-child">
                <Coupon
                  title={t("zine.couponTitle")}
                  offer={t("zine.couponOffer")}
                  fine={t("zine.couponFine")}
                  cut={t("zine.couponCut")}
                  done={t("zine.couponCut2")}
                  action={bookCall()}
                >
                  <ContactLinks part="call" />
                </Coupon>
              </CatPaw>
            </div>
            <div className="contact-side">
              <ContactLinks part="rest" />
              <p className="og-eyebrow contact-where">{t("contact.reply")}</p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <RevealObserver />
      <LateFaces />
      <Fly gone={t("zine.flyGone")} />
      <Mischief shout={t("zine.consoleShout")} note={t("zine.consoleNote")} />
    </>
  );
}
