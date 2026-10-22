import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/section-heading";
import "./personality.css";

type Note = { place: string; title: string; text: string; measures: string };

/**
 * The police blotter of production: a newspaper clipping taped to the
 * page, short notes under a masthead, each with where it happened, what
 * broke and the action taken. No employer is named next to an incident:
 * the place is the platform's own host or the kind of product. Long text,
 * so the clipping lies straight; the columns flow as the width allows.
 */
export async function IncidentReport() {
  const t = await getTranslations("incidents");
  const notes = t.raw("notes") as Note[];
  return (
    <section
      id="incidents"
      className="incidents og-container section-space"
      aria-labelledby="incidents-title"
    >
      <SectionHeading
        id="incidents-title"
        index={t("index")}
        label={t("label")}
        title={t("title")}
        accent={t("titleAccent")}
      />
      <p className="section-lead">{t("intro")}</p>
      <div className="blotter" data-reveal>
        <span className="tape is-left" aria-hidden="true" />
        <span className="tape is-right" aria-hidden="true" />
        {/* the newspaper's own rubric over the clipping: the section's
            heading above already names it */}
        <p className="blotter-mast" aria-hidden="true">
          {t("masthead")}
        </p>
        <ol className="blotter-notes">
          {notes.map((note, i) => (
            <li key={note.title}>
              <article aria-labelledby={`incident-${i + 1}`}>
                <p className="blotter-place">{note.place}</p>
                <h3 id={`incident-${i + 1}`}>{note.title}</h3>
                <p>{note.text}</p>
                <p className="blotter-measures">
                  <b>{t("measures")}</b> {note.measures}
                </p>
              </article>
            </li>
          ))}
        </ol>
        <p className="blotter-byline">{t("byline")}</p>
      </div>
    </section>
  );
}
