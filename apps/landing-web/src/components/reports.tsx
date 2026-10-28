import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import {
  ArrowUpRightIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import Image, { type StaticImageData } from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import boardEn from "@/assets/atelier/board-en.webp";
import boardRu from "@/assets/atelier/board-ru.webp";
import cvEn from "@/assets/atelier/cv-en.webp";
import cvRu from "@/assets/atelier/cv-ru.webp";
import phoneEn from "@/assets/roulette/phone-en.webp";
import phoneRu from "@/assets/roulette/phone-ru.webp";
import tableEn from "@/assets/roulette/table-en.webp";
import tableRu from "@/assets/roulette/table-ru.webp";
import { SahurCameo } from "@/components/bonk/cameo";
import { SectionHeading } from "@/components/section-heading";
import { WhenNear } from "@/components/when-near";

type Point = { mark: string; term: string; text: string };
type More = { key: string; name: string; text: string; action: string };
type Lang = "en" | "ru";

// 2x captures of the live services in each language
// (tools/quality/capture-roulette.mjs, capture-atelier.mjs)
const shots = {
  roulette: {
    en: { wide: tableEn, small: phoneEn },
    ru: { wide: tableRu, small: phoneRu },
  },
  atelier: {
    en: { wide: boardEn, small: cvEn },
    ru: { wide: boardRu, small: cvRu },
  },
} satisfies Record<
  string,
  Record<Lang, { wide: StaticImageData; small: StaticImageData }>
>;

const sites = {
  roulette: "https://roulette.outegro.dev",
  atelier: "https://atelier.outegro.dev",
  battleship: "https://battleship.outegro.dev",
  edu: "https://edu.outegro.dev",
} as const;

/** A roulette sector's colour: 0 green, 1 to 7 red, 8 to 14 black. */
const sector = (mark: string) => {
  const n = Number(mark);
  return n === 0 ? "green" : n <= 7 ? "red" : "black";
};

/**
 * One report of the issue: what the service is, its screens (a large one
 * and a smaller one over its corner), what is inside it as numbered points,
 * what it runs on and the way in. The large screen of the first report
 * hangs crooked until Tung Tung Tung Sahur bonks it straight (SahurCameo).
 */
async function Report({
  product,
  lang,
  crooked = false,
}: {
  product: "roulette" | "atelier";
  lang: Lang;
  crooked?: boolean;
}) {
  const t = await getTranslations("projects");
  const points = t.raw(`${product}.highlights`) as Point[];
  const stack = t.raw(`${product}.stack`) as string[];
  const set = shots[product][lang];
  const open = product === "roulette";
  const wide = open ? "table" : "board";
  const small = open ? "phone" : "cv";
  const title = `${product}-title`;
  return (
    <article
      id={product}
      className={`report is-${product}`}
      aria-labelledby={title}
    >
      <header className="report-head" data-reveal>
        <p className="report-kicker">{t(`${product}.kicker`)}</p>
        <h3 id={title} className="report-name">
          {t(`${product}.name`)}
        </h3>
        <p className="report-what">{t(`${product}.what`)}</p>
      </header>

      <div className="report-media">
        <figure
          className="report-shot is-wide"
          data-crooked={crooked ? "" : undefined}
        >
          {/* a screen ahead: the frames keep their size meanwhile */}
          <WhenNear
            className="report-frame"
            label={t(`${product}.shots.${wide}.alt`)}
          >
            <Image
              src={set.wide}
              alt={t(`${product}.shots.${wide}.alt`)}
              sizes="(max-width: 1023px) 92vw, 56vw"
              placeholder="empty"
            />
          </WhenNear>
          <figcaption>{t(`${product}.shots.${wide}.caption`)}</figcaption>
          <span className="tape is-top" aria-hidden="true" />
        </figure>
        <figure className={`report-shot is-small is-${small}`}>
          <WhenNear
            className="report-frame"
            label={t(`${product}.shots.${small}.alt`)}
          >
            <Image
              src={set.small}
              alt={t(`${product}.shots.${small}.alt`)}
              sizes={
                open
                  ? "(max-width: 767px) 34vw, 14vw"
                  : "(max-width: 767px) 56vw, 26vw"
              }
              placeholder="empty"
            />
          </WhenNear>
          <figcaption>{t(`${product}.shots.${small}.caption`)}</figcaption>
        </figure>
      </div>

      <div className="report-body">
        <h4 className="report-label">{t("highlightsTitle")}</h4>
        <ol className="report-points">
          {points.map((point) => (
            <li key={point.mark}>
              <span
                className="report-mark"
                data-sector={open ? sector(point.mark) : undefined}
                aria-hidden="true"
              >
                {point.mark}
              </span>
              <p>
                <b>{point.term}.</b> {point.text}
              </p>
            </li>
          ))}
        </ol>
        <h4 className="report-label">{t("stackTitle")}</h4>
        <ul className="badge-list">
          {stack.map((tech) => (
            <li key={tech}>
              <Badge>{tech}</Badge>
            </li>
          ))}
        </ul>
        <div className="report-way">
          {open ? (
            <Button asChild size="lg">
              <a href={sites.roulette}>
                {t("roulette.open")}
                <ArrowUpRightIcon aria-hidden="true" />
              </a>
            </Button>
          ) : (
            <>
              <p className="report-private">
                <LockSimpleIcon aria-hidden="true" weight="bold" />
                {t("atelier.private")}
              </p>
              <a className="report-invite" href={sites.atelier}>
                {t("atelier.open")}
                <span className="report-host">atelier.outegro.dev</span>
              </a>
            </>
          )}
          {open && <span className="report-host">roulette.outegro.dev</span>}
        </div>
        <p className="report-note">{t(`${product}.note`)}</p>
      </div>
    </article>
  );
}

/**
 * The reports: the platform's two main services, the roulette and the
 * atelier, each a spread of its own, then the rest of the platform in a
 * line of two cards.
 */
export async function Reports() {
  const t = await getTranslations("projects");
  const lang: Lang = (await getLocale()) === "ru" ? "ru" : "en";
  const more = t.raw("more.items") as More[];
  return (
    <section
      id="projects"
      className="reports og-container section-space"
      aria-labelledby="projects-title"
    >
      <SectionHeading
        id="projects-title"
        index={t("index")}
        label={t("label")}
        title={t("title")}
        accent={t("titleAccent")}
      />
      <p className="section-lead reports-lead" data-reveal>
        {t("intro")}
      </p>
      <Report product="roulette" lang={lang} crooked />
      <Report product="atelier" lang={lang} />
      <aside className="more" aria-labelledby="more-title">
        <h3 id="more-title" className="more-title">
          {t("more.title")}
        </h3>
        <ul className="more-list">
          {more.map((item) => {
            const href = sites[item.key as keyof typeof sites];
            return (
              <li key={item.key} className="more-card">
                <h4 className="more-name">{item.name}</h4>
                <p className="more-text">{item.text}</p>
                <a className="more-link" href={href}>
                  {item.action}
                  <span className="report-host">{new URL(href).host}</span>
                  <ArrowUpRightIcon aria-hidden="true" />
                </a>
              </li>
            );
          })}
        </ul>
      </aside>
      <SahurCameo target="#roulette .report-shot[data-crooked]" />
    </section>
  );
}
