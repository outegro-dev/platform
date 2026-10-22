import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { BonkRetry } from "@/components/bonk/bonk-retry";
import { ProjectScreens, ProjectStory } from "@/components/project-showcase";
import { FriendForm } from "./friend-form";
import { IssueFlight } from "./issue-flight";
import { Poster } from "./poster";

type TocItem = { title: string; href: string; page: string };

/**
 * The issue itself: the cover, opened at the contents, then turned to the
 * Battleship report, then turned once more and broken. Three leaves over a
 * last page: the cover leaf (the cover, and on its back a friends' form:
 * who, the favourite toys),
 * the contents leaf (the contents, and on its back the report's story,
 * page 2), the report leaf (the report's screens, page 3, and a blank back)
 * and a blank last page; over it all, the broken page that takes the
 * issue's place, where the 504 joke plays (BonkRetry). The markup keeps
 * them in reading order, so the headings and the keyboard go page by page;
 * how they stack is the CSS's.
 *
 * Without script, with reduced motion and on screens under 1024px the two
 * spreads simply lie one under the other. Otherwise IssueFlight flies the
 * first screen's cover here, opening it on the way, and turns the contents
 * leaf as the page scrolls on, a cue under the spread saying so.
 */
export async function Issue({ toc }: { toc: TocItem[] }) {
  const t = await getTranslations();
  // the running head: the issue (the magazine's name too, where there is
  // room), and on the right the date, or the section on a plaque
  const running = (section?: string) => (
    <p className="book-running" aria-hidden="true">
      <span>
        <span className="book-mast">{`${t("zine.poster.mast")} · `}</span>
        {t("zine.poster.issue")}
      </span>
      {section ? (
        <b className="book-section">{section}</b>
      ) : (
        <span>{t("zine.poster.date")}</span>
      )}
    </p>
  );
  const folio = (page: number) => (
    <p className="book-folio" aria-hidden="true">
      {page}
    </p>
  );
  // #about is the issue's top: the first spread, open on the friends' form
  // whether the book lies open or lands there in flight
  return (
    <section id="about" className="issue" aria-labelledby="toc-title">
      <div className="issue-pin og-container">
        <div className="issue-slot">
          <div className="book">
            <div className="book-leaf is-cover-leaf">
              <Poster className="book-face is-front" />
              <div className="book-face is-back book-sheet is-verso is-inside">
                {running()}
                <FriendForm />
              </div>
            </div>
            <div className="book-leaf is-contents-leaf">
              <div className="book-face is-front book-sheet is-recto is-contents">
                {running()}
                <nav className="toc" aria-labelledby="toc-title">
                  <h2 id="toc-title" className="toc-title">
                    {t("zine.tocTitle")}
                  </h2>
                  <ol>
                    {toc.map((item) => (
                      <li key={item.href}>
                        <a href={item.href}>
                          {/* the leader runs on from its last word */}
                          <span className="toc-name">
                            <span>{item.title}</span>
                          </span>
                          {/* an abbreviation's point («обл.») kerned in
                              its own span: the face is monospaced */}
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
                {folio(1)}
              </div>
              {/* focusable by script: a jump to #projects in flight lands
                  here (IssueFlight) */}
              <section
                id="projects"
                className="book-face is-back book-sheet is-verso is-story"
                aria-labelledby="projects-title"
                tabIndex={-1}
              >
                {running(t("projects.label"))}
                <ProjectStory />
                {folio(2)}
              </section>
            </div>
            <div className="book-leaf is-report-leaf">
              <div className="book-face is-front book-sheet is-recto is-screens">
                {running(t("projects.label"))}
                <ProjectScreens />
                {folio(3)}
              </div>
              <div className="book-face is-back is-blank" />
            </div>
            {/* past the report the issue breaks: the next pages are blank */}
            <div className="book-page is-blank" />
            {/* the right page's corner, lifting before the page turns */}
            <div className="book-curl" aria-hidden="true">
              <span />
            </div>
          </div>
          {/* in flight, under the spread: the scroll turns the pages, how
              far the issue is turned and which spread lies open
              (IssueFlight). The pages themselves are read in order */}
          <div className="issue-turn" aria-hidden="true">
            <span className="issue-turn-cue">
              {t("zine.turn.cue")}
              <ArrowDownIcon weight="bold" />
            </span>
            <span className="issue-turn-track">
              <span className="issue-turn-bar" />
            </span>
            <span className="issue-turn-count">
              {[1, 2].map((n) => (
                <span key={n} data-spread={n}>
                  {t("zine.turn.spread", { n, total: 2 })}
                </span>
              ))}
            </span>
          </div>
        </div>
        {/* instead of the issue, a broken page: the block "failed to load" */}
        <div className="issue-error" inert>
          <BonkRetry />
        </div>
      </div>
      {/* where the report is once the page has turned: IssueFlight moves
          the #projects id here while the issue is a scroll stage */}
      <span className="issue-anchor" aria-hidden="true" />
      <IssueFlight />
    </section>
  );
}
