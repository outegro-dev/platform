import type { BookResponse, ProgressResponse } from "@outegro/contracts/edu";
import {
  isUnderstood,
  knownCards,
  readableAccess,
  solvedIn,
} from "@outegro/edu-engine";
import { CardsIcon, LockSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  TocDeckProgress,
  TocDetails,
  TocSections,
  TocUnderstood,
} from "@/components/islands/toc-parts";
import { TocProgress } from "@/components/islands/toc-progress";
import { chapterHref, chapterIndex, deckHref, prefaceHref } from "@/lib/routes";

/** The page of the book the reader is on. */
export type TocCurrent =
  | { kind: "chapter"; n: number }
  | { kind: "preface" }
  | { kind: "deck" };

/**
 * The book's table of contents for the reading pages: chapters with their
 * number, short title, a lock where the reader cannot open them, the
 * solved count and a seal on the chapters understood; the current chapter
 * lists its sections (the one being read marked as the location); the
 * flash cards show how many are known. Interface words in the interface
 * language, titles in the book's.
 */
async function TocList({
  book,
  current,
  progress,
}: {
  book: BookResponse;
  current: TocCurrent;
  progress: ProgressResponse | null;
}) {
  const t = await getTranslations("reader");
  const { slug, locale } = book.book;
  return (
    <ol className="toc-list">
      {book.preface ? (
        <li>
          <Link
            href={prefaceHref(slug)}
            className="toc-link"
            aria-current={current.kind === "preface" ? "page" : undefined}
          >
            <span className="toc-n" aria-hidden="true">
              00
            </span>
            <span className="toc-short" lang={locale}>
              {book.preface.title}
            </span>
          </Link>
        </li>
      ) : null}
      {book.chapters.map((chapter) => {
        const here = current.kind === "chapter" && current.n === chapter.n;
        const readable = readableAccess.includes(chapter.access);
        const solved = progress ? solvedIn(progress.exercises, chapter.id) : 0;
        return (
          <li key={chapter.n}>
            <Link
              href={chapterHref(slug, chapter.n)}
              className="toc-link"
              aria-current={here ? "page" : undefined}
            >
              <span className="toc-n" aria-hidden="true">
                {chapterIndex(chapter.n)}
              </span>
              <span className="toc-short" lang={locale}>
                {chapter.short}
              </span>
              {readable ? (
                progress ? (
                  <span className="toc-meta">
                    <TocUnderstood
                      slug={slug}
                      n={chapter.n}
                      initial={isUnderstood(
                        progress.understanding[String(chapter.n)],
                      )}
                      label={t("understood")}
                    />
                    {chapter.exercises ? (
                      <TocProgress
                        slug={slug}
                        chapterId={chapter.id}
                        total={chapter.exercises}
                        initial={solved}
                      />
                    ) : null}
                  </span>
                ) : null
              ) : (
                <>
                  <LockSimpleIcon
                    className="toc-lock"
                    aria-hidden="true"
                    weight="bold"
                  />
                  <span className="sr-only">
                    , {chapter.access === "sign_in" ? t("signIn") : t("locked")}
                  </span>
                </>
              )}
            </Link>
            {here && chapter.sections.length ? (
              <TocSections
                sections={chapter.sections}
                locale={locale}
                label={t("inThisChapter")}
              />
            ) : null}
          </li>
        );
      })}
      <li className="toc-extra">
        <Link
          href={deckHref(slug)}
          className="toc-link"
          aria-current={current.kind === "deck" ? "page" : undefined}
        >
          <span className="toc-n" aria-hidden="true">
            <CardsIcon aria-hidden="true" />
          </span>
          <span className="toc-short">{t("deckLink")}</span>
          {progress ? (
            <TocDeckProgress
              slug={slug}
              total={book.book.stats.cards}
              initial={knownCards(Object.values(progress.cards))}
            />
          ) : null}
        </Link>
      </li>
    </ol>
  );
}

/** The sticky contents beside the reading column (wide screens). */
export async function TocAside(props: {
  book: BookResponse;
  current: TocCurrent;
  progress: ProgressResponse | null;
}) {
  const t = await getTranslations("reader");
  return (
    <aside className="toc-aside">
      <nav className="toc" aria-label={t("tocTitle")}>
        <p className="toc-heading">{t("tocTitle")}</p>
        <TocList {...props} />
      </nav>
    </aside>
  );
}

/**
 * The same contents folded above the chapter (phones and tablets); it
 * folds again once a link in it is chosen.
 */
export async function TocDisclosure({
  label,
  ...props
}: {
  book: BookResponse;
  current: TocCurrent;
  progress: ProgressResponse | null;
  /** Where the reader is, shown on the closed disclosure. */
  label: string;
}) {
  const t = await getTranslations("reader");
  return (
    <TocDetails className="toc-disclosure">
      <summary>
        <span className="toc-disclosure-title">{t("tocToggle")}</span>
        <span className="toc-disclosure-current">{label}</span>
      </summary>
      <nav className="toc" aria-label={t("tocTitle")}>
        <TocList {...props} />
      </nav>
    </TocDetails>
  );
}
