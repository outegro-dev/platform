import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/section-heading";
import { Stamp } from "@/components/zine/stamp";
import "./personality.css";

type Field = { label: string; value: string };
type Job = { period: string; hired: string; product: string; done: string[] };

/**
 * The work told as a Soviet employment record book, open on its spread:
 * the title page filled in by hand (name, education, occupation, the
 * holder's signature and the editorial office's seal) and the record
 * itself, an entry per job from the résumé: when, where and as whom (by
 * hand), what the company makes and what I was commended for (typed). No
 * entry ever says why a job ended. The seal and the signature are the
 * magazine's own decoration, no company's mark. The full résumé is a link
 * away, at /cv.
 */
export async function LabourBook() {
  const t = await getTranslations("record");
  const fields = t.raw("fields") as Field[];
  const jobs = t.raw("jobs") as Job[];
  return (
    <section
      id="record"
      className="record og-container section-space"
      aria-labelledby="record-title"
    >
      <SectionHeading
        id="record-title"
        index={t("index")}
        label={t("label")}
        title={t("title")}
        accent={t("titleAccent")}
      />
      <p className="section-lead">{t("intro")}</p>
      <div className="record-book" data-reveal>
        <article className="record-page is-title" aria-labelledby="record-book">
          <h3 id="record-book" className="record-book-title">
            {t("book")}
          </h3>
          {/* each answer written on its line, what it is printed under it */}
          <dl className="record-fields">
            {fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          <div className="record-signs" aria-hidden="true">
            <div className="record-signature">
              <svg viewBox="0 0 170 48" aria-hidden="true">
                <path d="M8 36C14 10 22 6 24 14S20 36 18 38M24 20c6-2 10 10 14 6s2-10 8-8 2 14 8 12 6-12 12-10-2 14 10 8 8-22 14-18-4 22 2 26 8-8 14-6 0 8 8 4M6 44c44-6 104-4 158-14" />
              </svg>
              <p>{t("signature")}</p>
            </div>
            <svg
              className="record-seal"
              viewBox="0 0 120 120"
              aria-hidden="true"
            >
              <defs>
                <path
                  id="record-seal-ring"
                  d="M60 60m-43 0a43 43 0 1 1 86 0a43 43 0 1 1-86 0"
                />
              </defs>
              <circle cx="60" cy="60" r="56" />
              <circle cx="60" cy="60" r="52" />
              <circle cx="60" cy="60" r="32" />
              <text>
                <textPath
                  href="#record-seal-ring"
                  textLength="268"
                  lengthAdjust="spacing"
                >
                  {t("seal")}
                </textPath>
              </text>
              <text x="60" y="68" textAnchor="middle" className="is-big">
                № 1
              </text>
            </svg>
          </div>
          {/* the length of service, stamped on what the page leaves blank */}
          <div className="record-stamp-place">
            <Stamp text={t("stamp")} tone="blue" />
          </div>
        </article>
        <article className="record-page is-jobs" aria-labelledby="record-jobs">
          <h3 id="record-jobs" className="record-jobs-title">
            {t("jobsTitle")}
          </h3>
          {/* the printed heads of the columns; each entry names its source
              itself for a reader that does not see them */}
          <p className="record-head" aria-hidden="true">
            <span>{t("columns.number")}</span>
            <span>{t("columns.date")}</span>
            <span>{t("columns.record")}</span>
            <span>{t("columns.basis")}</span>
          </p>
          <ol className="record-jobs">
            {jobs.map((job, i) => (
              <li key={job.hired} className="record-job">
                <p className="record-no" aria-hidden="true">
                  {i + 1}
                </p>
                <p className="record-date">{job.period}</p>
                <div className="record-text">
                  <h4>{job.hired}</h4>
                  <p className="record-product">{job.product}</p>
                  {job.done.length > 0 && (
                    <>
                      <p className="record-thanks">{t("thanks")}</p>
                      <ul>
                        {job.done.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <p className="record-basis">
                  <span className="record-basis-label">
                    {t("columns.basis")}:{" "}
                  </span>
                  {t("basis")}
                </p>
              </li>
            ))}
          </ol>
          <a href="/cv" className="record-cv">
            {t("cvLink")}
            <ArrowRightIcon aria-hidden="true" />
          </a>
        </article>
      </div>
    </section>
  );
}
