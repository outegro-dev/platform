import { fontVariables } from "@outegro/ui/fonts";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata, Viewport } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { EmailAddress, EmailLink } from "@/components/email-link";
import { Header } from "@/components/header";
import { SiteFooter } from "@/components/site-footer";
import { contacts } from "@/lib/contact";
import { openGraph } from "@/lib/metadata";
import { sso } from "@/lib/sso";
import { PrintButton } from "./print-button";
import "./cv.css";

type Job = {
  company: string;
  role: string;
  period: string;
  product: string;
  items: string[];
};
type Skill = { label: string; items: string };

/** Indexed like /stack and /privacy: its own canonical and share card. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cv.meta");
  const page = { title: t("title"), description: t("description"), url: "/cv" };
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.url },
    openGraph: openGraph(await getLocale(), page),
  };
}

// the main page's cream paper, which the offprint lies on (cv.css)
export const viewport: Viewport = { themeColor: "#f6eede" };

/** The address as it is printed: no scheme, no www, no trailing slash. */
const printed = (href: string) =>
  href.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");

/** The site, where the work can be seen; the ways to write follow it. */
const site = "https://outegro.dev";
/** Every link here leads off the site: a tab of its own. */
const away = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * The résumé as an offprint of the issue: one sheet in the calm level of
 * the zine (the same paper and headings, a sans to read), the one-page
 * résumé in the reader's language: the plain one, with the AI work, the
 * Counter-Strike projects from 2016 and the languages added. On paper (cv.css) only the
 * sheet prints, on one A4 page; the links print as their addresses.
 */
export default async function Cv() {
  const t = await getTranslations("cv");
  const about = t.raw("about") as string[];
  const jobs = t.raw("jobs") as Job[];
  const skills = t.raw("skills") as Skill[];
  const bold = (chunks: React.ReactNode) => <b>{chunks}</b>;
  return (
    <>
      <Header accounts={sso !== null} />
      <main id="main" className={`cv og-container ${fontVariables}`}>
        <div className="cv-tools" id="top">
          <a href="/" className="legal-back">
            <ArrowLeftIcon aria-hidden="true" />
            {t("back")}
          </a>
          <PrintButton label={t("print")} />
        </div>
        <article
          className="cv-sheet"
          data-theme="zine-calm"
          aria-labelledby="cv-name"
        >
          <p className="cv-offprint">
            <b>{t("kicker")}</b> <span>{t("from")}</span>
          </p>
          <header className="cv-head">
            <h1 id="cv-name">{t("name")}</h1>
            <p className="cv-role">{t("role")}</p>
            <ul className="cv-links" aria-label={t("links")}>
              <li>
                <a href={site} {...away}>
                  {printed(site)}
                </a>
              </li>
              <li>
                <EmailLink>
                  <EmailAddress />
                </EmailLink>
              </li>
              {contacts.map((contact) => (
                <li key={contact.key}>
                  <a href={contact.href} {...away}>
                    {printed(contact.href)}
                  </a>
                </li>
              ))}
            </ul>
          </header>

          <section aria-labelledby="cv-about">
            <h2 id="cv-about">{t("sections.about")}</h2>
            {about.map((paragraph, i) => (
              <p key={paragraph} className="cv-about">
                {t.rich(`about.${i}`, { b: bold })}
              </p>
            ))}
          </section>

          <section aria-labelledby="cv-experience">
            <h2 id="cv-experience">{t("sections.experience")}</h2>
            {jobs.map((job, j) => (
              <article
                key={job.company}
                className="cv-job"
                aria-labelledby={`cv-job-${j + 1}`}
              >
                <header className="cv-job-head">
                  <h3 id={`cv-job-${j + 1}`}>
                    {job.company}
                    <span className="cv-job-role"> · {job.role}</span>
                  </h3>
                  <p className="cv-period">{job.period}</p>
                </header>
                <p className="cv-product">{job.product}</p>
                {job.items.length > 0 && (
                  <ul>
                    {job.items.map((item, i) => (
                      <li key={item}>
                        {t.rich(`jobs.${j}.items.${i}`, { b: bold })}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>

          <section aria-labelledby="cv-skills">
            <h2 id="cv-skills">{t("sections.skills")}</h2>
            <dl className="cv-skills">
              {skills.map((skill) => (
                <div key={skill.label}>
                  <dt>{skill.label}</dt>
                  <dd>{skill.items}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* the languages are on this page only, never on the landing */}
          <section aria-labelledby="cv-education">
            <h2 id="cv-education">{t("sections.education")}</h2>
            <p className="cv-edu">
              <span>
                <b>{t("education.school")}</b> · {t("education.degree")}
              </span>
              <span className="cv-period">{t("education.period")}</span>
            </p>
            <p className="cv-languages">{t("languages")}</p>
          </section>

          <p className="cv-imprint">{t("imprint")}</p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
