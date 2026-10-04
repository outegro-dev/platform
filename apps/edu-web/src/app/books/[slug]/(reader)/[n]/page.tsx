import { Button } from "@outegro/ui/button";
import { BookOpenTextIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Blocks } from "@/components/book/blocks";
import { blockContext } from "@/components/book/prepare";
import { OpenChapter } from "@/components/islands/open-chapter";
import { SectionSpy } from "@/components/islands/section-spy";
import {
  BookUnavailable,
  ReaderFrame,
  ReaderGate,
} from "@/components/reader/reader-frame";
import { ChapterHead, Pager, SaveHint } from "@/components/reader/reader-parts";
import {
  assistStatus,
  chapterNumber,
  isBookSlug,
  loadBook,
  loadChapter,
  loadReader,
} from "@/lib/api";
import { chapterHref } from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/books/[slug]/[n]">): Promise<Metadata> {
  const { slug, n } = await params;
  const number = chapterNumber(n);
  if (!isBookSlug(slug) || number === null) return {};
  const book = await loadBook(slug);
  if (book.status !== "ok") return {};
  const chapter = book.data.chapters.find((item) => item.n === number);
  return chapter ? { title: `${chapter.title} — ${book.data.book.title}` } : {};
}

/**
 * A chapter: the book's contents beside it, the text with its islands and
 * the reading assistant's helpers ("explain it differently" under every
 * section heading, "explain it in your own words" before the recap), and
 * the way to the next one. Without access, the same frame explains why
 * (sign in, or get access) instead of the text.
 */
export default async function ChapterPage({
  params,
}: PageProps<"/books/[slug]/[n]">) {
  const { slug, n } = await params;
  const number = chapterNumber(n);
  if (!isBookSlug(slug) || number === null) notFound();
  const r = await getTranslations("reader");
  const path = chapterHref(slug, number);
  const [book, chapter, reader, assist] = await Promise.all([
    loadBook(slug),
    loadChapter(slug, number),
    loadReader(slug),
    assistStatus(),
  ]);
  if (book.status === "not-found" || chapter.status === "not-found") notFound();
  if (book.status !== "ok")
    return (
      <BookUnavailable
        path={path}
        title={r("unavailableTitle")}
        body={r("unavailableBody")}
      />
    );
  const toc = book.data.chapters.find((item) => item.n === number);
  if (!toc) notFound();
  const summary = book.data.book;
  const frame = {
    book: book.data,
    reader,
    current: { kind: "chapter", n: number } as const,
    tocLabel: r("tocCurrent", { n: number, short: toc.short }),
    path,
  };

  if (chapter.status === "ok") {
    const data = chapter.data;
    const context = await blockContext({
      locale: data.book.locale,
      blocks: data.chapter.blocks,
      eventLoop: data.eventLoop,
      sandbox: data.sandbox,
    });
    return (
      <ReaderFrame
        {...frame}
        sandboxSeed={data.sandbox?.seed ?? null}
        assist={assist}
      >
        <article className="book-article" lang={data.book.locale}>
          <ChapterHead
            index={number}
            label={data.chapter.short}
            title={data.chapter.title}
            lead={data.chapter.lead}
            locale={data.book.locale}
          />
          {reader.signedIn ? null : (
            <SaveHint path={path} locale={await getLocale()} />
          )}
          <div className="book-text">
            <Blocks
              blocks={data.chapter.blocks}
              context={context}
              chapter={{ n: number, short: data.chapter.short }}
            />
          </div>
        </article>
        <OpenChapter n={number} />
        <SectionSpy ids={toc.sections.map((section) => section.id)} />
        <Pager
          slug={slug}
          locale={data.book.locale}
          prev={data.prev}
          next={data.next}
        />
      </ReaderFrame>
    );
  }

  const index = book.data.chapters.indexOf(toc);
  const prev = book.data.chapters[index - 1];
  const next = book.data.chapters[index + 1];
  const locked = chapter.status === "forbidden";
  return (
    <ReaderFrame {...frame}>
      <ReaderGate
        status={chapter.status}
        book={summary}
        path={path}
        title={locked ? r("gateLockedTitle") : r("gateSignInTitle")}
        unavailable={{
          title: r("unavailableTitle"),
          body: r("unavailableBody"),
        }}
        head={
          <ChapterHead
            index={number}
            label={toc.short}
            title={toc.title}
            locale={summary.locale}
          />
        }
      >
        {locked && summary.previewChapters > 0 && number > 1 ? (
          <p className="gate-more">
            <Button asChild variant="outline">
              <Link href={chapterHref(slug, 1)}>
                <BookOpenTextIcon aria-hidden="true" />
                {r("firstChapter")}
              </Link>
            </Button>
          </p>
        ) : null}
      </ReaderGate>
      <Pager
        slug={slug}
        locale={summary.locale}
        prev={prev ? { n: prev.n, short: prev.short } : null}
        next={next ? { n: next.n, short: next.short } : null}
      />
    </ReaderFrame>
  );
}
