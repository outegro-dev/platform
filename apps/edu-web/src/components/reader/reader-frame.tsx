import type {
  AssistStatus,
  BookResponse,
  BookSummary,
  ProgressResponse,
} from "@outegro/contracts/edu";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { accentStyle } from "@/components/book/accent";
import { ScrollToHash } from "@/components/islands/scroll-to-hash";
import { newShuffleSeed } from "@/lib/api";
import { ReaderStoresProvider } from "@/stores/provider";
import { AccessPanel } from "./access-panel";
import { ReaderLayout } from "./reader-parts";
import { TocAside, type TocCurrent, TocDisclosure } from "./toc";
import { Unavailable } from "./unavailable";

/**
 * The frame of every reading page (a chapter, the preface, the deck): the
 * book's contents beside the column, the reader's stores for the page's
 * islands, and the book's own words for the column (a nested intl provider
 * in the book's language with the `book` messages only; the contents keep
 * the interface's language). Pages load their content themselves and put
 * it, or a gate, inside. Each view gets a new seed for its first shuffles,
 * sent along so the browser agrees.
 */
export async function ReaderFrame({
  book,
  reader,
  current,
  tocLabel,
  path,
  sandboxSeed = null,
  assist = null,
  children,
}: {
  book: BookResponse;
  reader: { signedIn: boolean; progress: ProgressResponse | null };
  current: TocCurrent;
  /** Where the reader is, on the folded contents. */
  tocLabel: string;
  /** This page: a new page gets fresh stores. */
  path: string;
  sandboxSeed?: string | null;
  /**
   * The assistant's status, on pages with its helpers (chapters); unknown
   * (null: signed out, or it did not load), the page has no helpers.
   */
  assist?: AssistStatus | null;
  children: ReactNode;
}) {
  const { slug, locale, theme } = book.book;
  const messages = await getMessages({ locale });
  const shuffleSeed = newShuffleSeed();
  return (
    <main id="main" className="app-main app-main-tall reader-page">
      <ReaderStoresProvider
        key={path}
        init={{
          slug,
          signedIn: reader.signedIn,
          progress: reader.progress,
          sandboxSeed,
          shuffleSeed,
          assist,
        }}
      >
        <ReaderLayout
          style={accentStyle(theme)}
          aside={
            <TocAside
              book={book}
              current={current}
              progress={reader.progress}
            />
          }
          disclosure={
            <TocDisclosure
              book={book}
              current={current}
              progress={reader.progress}
              label={tocLabel}
            />
          }
        >
          <NextIntlClientProvider
            locale={locale}
            messages={{ book: messages.book }}
          >
            {children}
          </NextIntlClientProvider>
        </ReaderLayout>
        <ScrollToHash />
      </ReaderStoresProvider>
    </main>
  );
}

/**
 * A reading page whose content did not come: why (sign in, no access) and
 * what to do, or that the library did not answer, under the page's head.
 */
export async function ReaderGate({
  status,
  head,
  book,
  path,
  title,
  unavailable,
  children,
}: {
  status: "signed-out" | "forbidden" | "unavailable";
  head: ReactNode;
  book: BookSummary;
  path: string;
  /** The gate's title instead of the access panel's own. */
  title?: string;
  unavailable: { title: string; body: string };
  /** More ways on from a closed page (e.g. the open chapter 1). */
  children?: ReactNode;
}) {
  const r = await getTranslations("reader");
  if (status === "unavailable")
    return (
      <article className="book-article">
        {head}
        <Unavailable
          title={unavailable.title}
          body={unavailable.body}
          retry={r("retry")}
          href={path}
        />
      </article>
    );
  return (
    <article className="book-article" data-testid="chapter-gate">
      {head}
      <AccessPanel
        access={status === "forbidden" ? "locked" : "sign_in"}
        features={book.features}
        previewChapters={book.previewChapters}
        path={path}
        title={title}
      />
      {children}
    </article>
  );
}

/** The book itself did not load: no contents to show beside anything. */
export async function BookUnavailable({
  path,
  title,
  body,
}: {
  path: string;
  title: string;
  body: string;
}) {
  const r = await getTranslations("reader");
  return (
    <main id="main" className="app-main og-container">
      <Unavailable title={title} body={body} retry={r("retry")} href={path} />
    </main>
  );
}
