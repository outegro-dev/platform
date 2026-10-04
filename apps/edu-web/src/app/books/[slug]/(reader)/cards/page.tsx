import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { InlineText } from "@/components/book/inline";
import { Deck } from "@/components/islands/deck";
import { AccessPanel } from "@/components/reader/access-panel";
import {
  BookUnavailable,
  ReaderFrame,
  ReaderGate,
} from "@/components/reader/reader-frame";
import { ChapterHead, SaveHint } from "@/components/reader/reader-parts";
import { isBookSlug, loadBook, loadDeck, loadReader } from "@/lib/api";
import { deckHref } from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/books/[slug]/cards">): Promise<Metadata> {
  const { slug } = await params;
  if (!isBookSlug(slug)) return {};
  const book = await loadBook(slug);
  return book.status === "ok"
    ? { title: `${book.data.deck.title} — ${book.data.book.title}` }
    : {};
}

/** Every flash card of the chapters the reader can open, as one deck. */
export default async function DeckPage({
  params,
}: PageProps<"/books/[slug]/cards">) {
  const { slug } = await params;
  if (!isBookSlug(slug)) notFound();
  const r = await getTranslations("reader");
  const d = await getTranslations("deckPage");
  const path = deckHref(slug);
  const [book, deck, reader] = await Promise.all([
    loadBook(slug),
    loadDeck(slug),
    loadReader(slug),
  ]);
  if (book.status === "not-found" || deck.status === "not-found") notFound();
  if (book.status !== "ok")
    return (
      <BookUnavailable
        path={path}
        title={d("unavailableTitle")}
        body={d("unavailableBody")}
      />
    );
  const summary = book.data.book;
  const info = book.data.deck;
  const frame = {
    book: book.data,
    reader,
    current: { kind: "deck" } as const,
    tocLabel: r("deckLink"),
    path,
  };
  const head = (
    <ChapterHead
      index={null}
      label={info.kicker}
      title={info.title}
      locale={summary.locale}
    />
  );

  if (deck.status !== "ok")
    return (
      <ReaderFrame {...frame}>
        <ReaderGate
          status={deck.status}
          book={summary}
          path={path}
          head={head}
          unavailable={{
            title: d("unavailableTitle"),
            body: d("unavailableBody"),
          }}
        />
      </ReaderFrame>
    );

  const data = deck.data;
  const uiLocale = await getLocale();
  return (
    <ReaderFrame {...frame}>
      <article className="book-article deck-page" lang={data.book.locale}>
        {head}
        <div className="deck-intro">
          {info.intro.map((paragraph, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: intro paragraphs never reorder
            <p key={index}>
              <InlineText nodes={paragraph} />
            </p>
          ))}
        </div>
        {reader.signedIn ? null : <SaveHint path={path} locale={uiLocale} />}
        <Deck chapters={data.chapters} />
        {data.lockedCards > 0 ? (
          <div className="deck-locked" lang={uiLocale}>
            <p>{d("lockedCards", { count: data.lockedCards })}</p>
            <AccessPanel
              access={reader.signedIn ? "locked" : "sign_in"}
              features={summary.features}
              previewChapters={summary.previewChapters}
              path={path}
              headingLevel={2}
            />
          </div>
        ) : null}
      </article>
    </ReaderFrame>
  );
}
