import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/section-heading";
import "./personality.css";

/**
 * The editor's column: how I came to code, in the first person (the
 * approved about-me), signed by hand. Long text, so it lies straight on
 * clean paper, in two columns where the page is wide, a drop cap first.
 */
export async function EditorColumn() {
  const t = await getTranslations("column");
  const text = t.raw("text") as string[];
  return (
    <section
      id="column"
      className="column og-container section-space"
      aria-labelledby="column-title"
    >
      <SectionHeading
        id="column-title"
        index={t("index")}
        label={t("label")}
        title={t("title")}
        accent={t("titleAccent")}
      />
      <article className="column-body" data-reveal>
        {text.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {/* the name in blue ink, a stroke of the pen under it */}
        <footer className="column-sign">
          <p className="column-name">{t("sign")}</p>
          <svg
            className="column-flourish"
            viewBox="0 0 160 24"
            aria-hidden="true"
          >
            <path d="M4 16c30-10 70-14 118-8 14 2 24 1 34-4M30 20c24-4 52-5 80-2" />
          </svg>
          <p className="column-role">{t("signRole")}</p>
        </footer>
      </article>
    </section>
  );
}
