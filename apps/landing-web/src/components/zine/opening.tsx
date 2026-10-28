import { getTranslations } from "next-intl/server";
import { FriendForm } from "./friend-form";

type TocItem = { title: string; href: string; page: string };

/**
 * The issue opened past its cover: one spread, the inside of the cover with
 * a friends' questionnaire (who, the job, the favourite toys) on the left
 * and the contents on the right, each line a link to its section. Plain
 * pages lying on the table, read in order; a phone has them one under the
 * other.
 */
export async function Opening({ toc }: { toc: TocItem[] }) {
  const t = await getTranslations("zine");
  // the running head: the issue (the magazine's name too, where there is
  // room) and the date
  const running = (
    <p className="sheet-running" aria-hidden="true">
      <span>
        <span className="sheet-mast">{`${t("poster.mast")} · `}</span>
        {t("poster.issue")}
      </span>
      <span>{t("poster.date")}</span>
    </p>
  );
  return (
    <section
      id="about"
      className="opening og-container"
      aria-labelledby="form-title"
    >
      <div className="spread">
        <div className="sheet is-verso is-inside">
          {running}
          <FriendForm />
        </div>
        <div className="sheet is-recto is-contents">
          {running}
          <nav className="toc" aria-labelledby="toc-title">
            <h2 id="toc-title" className="toc-title">
              {t("tocTitle")}
            </h2>
            <ol>
              {toc.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>
                    {/* the leader runs on from its last word */}
                    <span className="toc-name">
                      <span>{item.title}</span>
                    </span>
                    {/* an abbreviation's point («обл.») kerned in its own
                        span: the face is monospaced */}
                    <span className="toc-page">
                      {item.page.replace(/\.$/, "")}
                      {item.page.endsWith(".") && (
                        <span className="toc-point">.</span>
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <p className="sheet-folio" aria-hidden="true">
            1
          </p>
        </div>
      </div>
    </section>
  );
}
