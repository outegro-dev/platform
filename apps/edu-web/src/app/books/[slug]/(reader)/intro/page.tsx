import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Blocks } from "@/components/book/blocks";
import { blockContext } from "@/components/book/prepare";
import {
  BookUnavailable,
  ReaderFrame,
  ReaderGate,
} from "@/components/reader/reader-frame";
import { ChapterHead, Pager, SaveHint } from "@/components/reader/reader-parts";
import { isBookSlug, loadBook, loadPreface, loadReader } from "@/lib/api";
import { prefaceHref } from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/books/[slug]/intro">): Promise<Metadata> {
  const { slug } = await params;
  if (!isBookSlug(slug)) return {};
  const book = await loadBook(slug);
  return book.status === "ok" && book.data.preface
    ? { title: `${book.data.preface.title} — ${book.data.book.title}` }
    : {};
}

/** The introduction before chapter 1 (the SQL book's training database). */
export default async function PrefacePage({
  params,
}: PageProps<"/books/[slug]/intro">) {
  const { slug } = await params;
  if (!isBookSlug(slug)) notFound();
  const r = await getTranslations("reader");
  const path = prefaceHref(slug);
  const [book, preface, reader] = await Promise.all([
    loadBook(slug),
    loadPreface(slug),
    loadReader(slug),
  ]);
  if (book.status === "not-found" || preface.status === "not-found") notFound();
  if (book.status !== "ok")
    return (
      <BookUnavailable
        path={path}
        title={r("unavailableTitle")}
        body={r("unavailableBody")}
      />
    );
  const intro = book.data.preface;
  if (!intro) notFound();
  const summary = book.data.book;
  const first = book.data.chapters[0];
  const frame = {
    book: book.data,
    reader,
    current: { kind: "preface" } as const,
    tocLabel: intro.title,
    path,
  };
  const pager = (
    <Pager
      slug={slug}
      locale={summary.locale}
      prev={null}
      next={first ? { n: first.n, short: first.short } : null}
    />
  );

  if (preface.status === "ok") {
    const data = preface.data;
    const context = await blockContext({
      locale: data.book.locale,
      blocks: data.preface.blocks,
      eventLoop: null,
      sandbox: data.sandbox,
    });
    return (
      <ReaderFrame {...frame} sandboxSeed={data.sandbox?.seed ?? null}>
        <article className="book-article" lang={data.book.locale}>
          <ChapterHead
            index={null}
            label={data.preface.kicker}
            title={data.preface.title}
            locale={data.book.locale}
          />
          {reader.signedIn ? null : (
            <SaveHint path={path} locale={await getLocale()} />
          )}
          <div className="book-text">
            <Blocks blocks={data.preface.blocks} context={context} />
          </div>
        </article>
        {pager}
      </ReaderFrame>
    );
  }

  return (
    <ReaderFrame {...frame}>
      <ReaderGate
        status={preface.status}
        book={summary}
        path={path}
        unavailable={{
          title: r("unavailableTitle"),
          body: r("unavailableBody"),
        }}
        head={
          <ChapterHead
            index={null}
            label={intro.kicker}
            title={intro.title}
            locale={summary.locale}
          />
        }
      />
      {pager}
    </ReaderFrame>
  );
}
