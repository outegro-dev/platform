import { readableAccess, solvedIn } from "@outegro/edu-engine";
import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import {
  ArrowLeftIcon,
  BookOpenTextIcon,
  CardsIcon,
  DatabaseIcon,
  LockSimpleIcon,
  SignInIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { accentStyle } from "@/components/book/accent";
import { InlineText } from "@/components/book/inline";
import { bookCta } from "@/components/library/book-card";
import {
  AccessBadge,
  BookCover,
  BookStatsList,
  ProgressMeters,
} from "@/components/library/book-parts";
import { AccessPanel, AccessSummary } from "@/components/reader/access-panel";
import { Unavailable } from "@/components/reader/unavailable";
import { assistStatus, isBookSlug, loadBook, loadReader } from "@/lib/api";
import {
  bookHref,
  chapterHref,
  chapterIndex,
  deckHref,
  prefaceHref,
} from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/books/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isBookSlug(slug)) return {};
  const book = await loadBook(slug);
  return book.status === "ok" ? { title: book.data.book.title } : {};
}

/** "Node.js изнутри" → "Node.js" and the accent line "изнутри". */
function splitTitle(title: string): [string, string] {
  const space = title.lastIndexOf(" ");
  return space > 0
    ? [title.slice(0, space), title.slice(space + 1)]
    : [title, ""];
}

/**
 * A book: what it is, the reader's access and progress, the ways in
 * (continue past chapter 1, start from the first chapter, the flash
 * cards), a note on the reading assistant when it is on, and the contents.
 */
export default async function BookPage({ params }: PageProps<"/books/[slug]">) {
  const { slug } = await params;
  if (!isBookSlug(slug)) notFound();
  const t = await getTranslations("bookPage");
  const b = await getTranslations("bookCard");
  const r = await getTranslations("reader");
  const [loaded, reader, assist] = await Promise.all([
    loadBook(slug),
    loadReader(slug),
    assistStatus(),
  ]);
  if (loaded.status === "not-found") notFound();
  if (loaded.status !== "ok") {
    return (
      <main id="main" className="app-main og-container">
        <Unavailable
          title={t("unavailableTitle")}
          body={t("unavailableBody")}
          retry={r("retry")}
          href={bookHref(slug)}
        />
      </main>
    );
  }
  const { book, chapters, preface, deck, note } = loaded.data;
  const mine = reader.progress;
  const cta = bookCta(book);
  const [head, tail] = splitTitle(book.title);
  const lastChapter =
    cta.kind === "continue"
      ? chapters.find((chapter) => chapter.n === cta.n)
      : undefined;
  // The assistant's words are the book's, like its helpers in the chapters.
  const words = await getTranslations({
    locale: book.locale,
    namespace: "book.assist",
  });
  const showAssist =
    assist?.enabled === true &&
    chapters.some((chapter) => readableAccess.includes(chapter.access));

  return (
    <main
      id="main"
      className="app-main app-main-tall og-container book-page"
      style={accentStyle(book.theme)}
    >
      <Link href="/" className="back-link">
        <ArrowLeftIcon aria-hidden="true" />
        {t("breadcrumb")}
      </Link>
      <section className="book-hero">
        <div className="book-hero-text">
          <p className="og-eyebrow" lang={book.locale}>
            {book.kicker}
          </p>
          <h1 className="book-title" lang={book.locale}>
            {head}
            {tail ? (
              <>
                {" "}
                <span className="og-accent">{tail}</span>
              </>
            ) : null}
          </h1>
          <p className="book-lead" lang={book.locale}>
            <InlineText nodes={book.lead} />
          </p>
          <BookStatsList stats={book.stats} detailed />
          <div className="book-card-badges">
            <AccessBadge access={book.access} />
          </div>
          {cta.kind === "details" ? null : (
            <div className="book-hero-actions">
              {cta.kind === "signIn" ? (
                <Button asChild size="lg">
                  <a href={cta.href} data-testid="book-cta">
                    <SignInIcon aria-hidden="true" />
                    {b("cta.signIn")}
                  </a>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg">
                    <Link href={cta.href} data-testid="book-cta">
                      <BookOpenTextIcon aria-hidden="true" />
                      {cta.kind === "continue"
                        ? t("continue", { n: cta.n })
                        : t("startFirst")}
                    </Link>
                  </Button>
                  {cta.kind === "continue" ? (
                    <Button asChild size="lg" variant="outline">
                      <Link
                        href={chapterHref(slug, 1)}
                        data-testid="book-start"
                      >
                        {t("startFirst")}
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild size="lg" variant="outline">
                    <Link href={deckHref(slug)} data-testid="book-deck">
                      <CardsIcon aria-hidden="true" />
                      {t("deckCta")}
                    </Link>
                  </Button>
                </>
              )}
            </div>
          )}
          {lastChapter ? (
            <p className="continue-note">
              <span className="continue-label">{t("continueTitle")}:</span>{" "}
              <span lang={book.locale}>
                {t("continueChapter", {
                  n: lastChapter.n,
                  short: lastChapter.short,
                })}
              </span>
            </p>
          ) : null}
          {showAssist ? (
            <p
              className="book-assist-note"
              lang={book.locale}
              data-testid="assist-note"
            >
              {words.rich("heroNote", {
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          ) : null}
          <AccessSummary
            access={book.access}
            features={book.features}
            previewChapters={book.previewChapters}
          />
          {book.progress ? (
            <ProgressMeters
              slug={book.slug}
              exercisesSolved={book.progress.exercisesSolved}
              exercises={book.stats.exercises}
              cardsKnown={book.progress.cardsKnown}
              cards={book.stats.cards}
            />
          ) : null}
        </div>
        <BookCover
          svg={book.cover}
          lang={book.locale}
          className="book-hero-cover"
        />
      </section>

      {book.access === "locked" || book.access === "preview" ? (
        <div className="book-access">
          <AccessPanel
            access={book.access}
            features={book.features}
            previewChapters={book.previewChapters}
            path={bookHref(slug)}
          />
        </div>
      ) : null}

      <section className="contents" aria-labelledby="contents-title">
        <div className="section-head">
          <h2 id="contents-title" className="section-title">
            {t("contentsTitle")}
          </h2>
          <p className="muted">{t("contentsLead")}</p>
        </div>
        <ol className="contents-list">
          {preface ? (
            <li>
              <Link href={prefaceHref(slug)} className="contents-row">
                <span className="contents-n" aria-hidden="true">
                  <DatabaseIcon aria-hidden="true" />
                </span>
                <span className="contents-body">
                  <span className="contents-kicker" lang={book.locale}>
                    {preface.kicker}
                  </span>
                  <span className="contents-title" lang={book.locale}>
                    {preface.title}
                  </span>
                  <span className="contents-meta">{t("prefaceNote")}</span>
                </span>
              </Link>
            </li>
          ) : null}
          {chapters.map((chapter) => {
            const readable = readableAccess.includes(chapter.access);
            const solved = mine ? solvedIn(mine.exercises, chapter.id) : 0;
            return (
              <li key={chapter.n}>
                <Link
                  href={chapterHref(slug, chapter.n)}
                  className="contents-row"
                  data-locked={!readable || undefined}
                >
                  <span className="contents-n" aria-hidden="true">
                    {chapterIndex(chapter.n)}
                  </span>
                  <span className="contents-body">
                    <span className="contents-kicker">
                      {t("chapter", { n: chapter.n })}
                      {" · "}
                      <span lang={book.locale}>{chapter.short}</span>
                    </span>
                    <span className="contents-title" lang={book.locale}>
                      {chapter.title}
                    </span>
                    <span className="contents-meta">
                      {t("sections", { count: chapter.sections.length })}
                      {" · "}
                      {mine && readable && chapter.exercises
                        ? t("solved", {
                            solved,
                            total: chapter.exercises,
                          })
                        : t("exercises", { count: chapter.exercises })}
                    </span>
                  </span>
                  <span className="contents-state">
                    {readable ? (
                      chapter.access === "preview" ? (
                        <Badge variant="muted">{t("preview")}</Badge>
                      ) : null
                    ) : (
                      <>
                        <LockSimpleIcon aria-hidden="true" weight="bold" />
                        <span className="sr-only">
                          {chapter.access === "sign_in"
                            ? t("signIn")
                            : t("locked")}
                        </span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
          <li>
            <Link href={deckHref(slug)} className="contents-row">
              <span className="contents-n" aria-hidden="true">
                <CardsIcon aria-hidden="true" />
              </span>
              <span className="contents-body">
                <span className="contents-kicker" lang={book.locale}>
                  {deck.kicker}
                </span>
                <span className="contents-title" lang={book.locale}>
                  {deck.title}
                </span>
                <span className="contents-meta">
                  {t("deckCards", { count: book.stats.cards })}
                </span>
              </span>
            </Link>
          </li>
        </ol>
      </section>
      {note ? (
        <p className="book-note" lang={book.locale}>
          <InlineText nodes={note} />
        </p>
      ) : null}
    </main>
  );
}
