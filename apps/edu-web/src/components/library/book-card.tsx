import type { BookSummary } from "@outegro/contracts/edu";
import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { Surface } from "@outegro/ui/surface";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  ListBulletsIcon,
  SignInIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { accentStyle } from "@/components/book/accent";
import { InlineText } from "@/components/book/inline";
import { bookHref, chapterHref, signInHref } from "@/lib/routes";
import {
  AccessBadge,
  BookCover,
  BookStatsList,
  ProgressMeters,
} from "./book-parts";

export type BookCta =
  | { kind: "start"; href: string }
  | { kind: "continue"; href: string; n: number }
  | { kind: "signIn"; href: string }
  | { kind: "details"; href: string };

/**
 * The main action for a book: continue where the reader stopped (once
 * that is past the first chapter, as the book's own pages did), start,
 * sign in (back to the book page, which then shows their progress), or,
 * without access, see what the book has and how to get it.
 */
export function bookCta(book: BookSummary): BookCta {
  if (book.access === "sign_in")
    return { kind: "signIn", href: signInHref(bookHref(book.slug)) };
  if (book.access === "locked")
    return { kind: "details", href: bookHref(book.slug) };
  const last = book.progress?.lastChapter;
  return last && last > 1
    ? { kind: "continue", href: chapterHref(book.slug, last), n: last }
    : { kind: "start", href: chapterHref(book.slug, 1) };
}

/** A book in the library: cover, what it is, what is inside, access, progress. */
export async function BookCard({ book }: { book: BookSummary }) {
  const t = await getTranslations("bookCard");
  const library = await getTranslations("library");
  const cta = bookCta(book);
  const label =
    cta.kind === "continue"
      ? t("cta.continue", { n: cta.n })
      : cta.kind === "start"
        ? t("cta.start")
        : cta.kind === "signIn"
          ? t("cta.signIn")
          : t("cta.details");
  const Icon =
    cta.kind === "signIn"
      ? SignInIcon
      : cta.kind === "details"
        ? ArrowRightIcon
        : BookOpenTextIcon;
  return (
    <Surface
      asChild
      className="book-card"
      style={accentStyle(book.theme)}
      data-testid={`book-${book.slug}`}
    >
      <article>
        <BookCover
          svg={book.cover}
          lang={book.locale}
          className="book-card-cover"
        />
        <div className="book-card-body">
          <p className="og-eyebrow" lang={book.locale}>
            {book.kicker}
          </p>
          <h2 className="book-card-title">
            <Link href={bookHref(book.slug)} lang={book.locale}>
              {book.title}
            </Link>
          </h2>
          <p className="book-card-lead" lang={book.locale}>
            <InlineText nodes={book.lead} />
          </p>
          <BookStatsList stats={book.stats} />
          <div className="book-card-badges">
            <AccessBadge access={book.access} />
            <Badge variant="muted">
              {library("inLanguage", {
                language: library(`languages.${book.locale}`),
              })}
            </Badge>
          </div>
          {book.progress ? (
            <ProgressMeters
              slug={book.slug}
              exercisesSolved={book.progress.exercisesSolved}
              exercises={book.stats.exercises}
              cardsKnown={book.progress.cardsKnown}
              cards={book.stats.cards}
            />
          ) : null}
          <div className="book-card-actions">
            <Button asChild size="md">
              {cta.kind === "signIn" ? (
                <a href={cta.href} data-testid="book-cta">
                  <Icon aria-hidden="true" />
                  {label}
                </a>
              ) : (
                <Link href={cta.href} data-testid="book-cta">
                  <Icon aria-hidden="true" />
                  {label}
                </Link>
              )}
            </Button>
            {cta.kind === "details" ? null : (
              <Button asChild size="md" variant="ghost">
                <Link href={bookHref(book.slug)}>
                  <ListBulletsIcon aria-hidden="true" />
                  {t("cta.contents")}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </article>
    </Surface>
  );
}
