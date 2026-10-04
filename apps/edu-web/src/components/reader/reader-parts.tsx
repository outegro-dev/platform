import type { Inline } from "@outegro/contracts/edu";
import { Button } from "@outegro/ui/button";
import { Notice } from "@outegro/ui/notice";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  SignInIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { InlineText } from "@/components/book/inline";
import { chapterHref, chapterIndex, signInHref } from "@/lib/routes";

/**
 * The head of a chapter: the mono index (`03 ── Async`), the title and the
 * lead. Reading sizes, not display sizes: this is the start of the text.
 */
export function ChapterHead({
  index,
  label,
  title,
  lead,
  locale,
}: {
  /** The chapter number; null for the preface and the deck. */
  index: number | null;
  label: string;
  title: string;
  lead?: readonly Inline[] | null;
  locale: string;
}) {
  return (
    <header className="chapter-head" lang={locale}>
      <p className="chapter-index">
        {index === null ? null : (
          <>
            <span className="chapter-n">{chapterIndex(index)}</span>
            <span className="chapter-rule" aria-hidden="true">
              ──
            </span>
          </>
        )}
        <span>{label}</span>
      </p>
      <h1 className="chapter-title">{title}</h1>
      {lead?.length ? (
        <p className="chapter-lead">
          <InlineText nodes={lead} />
        </p>
      ) : null}
    </header>
  );
}

/** Previous and next chapter at the end of one. */
export async function Pager({
  slug,
  locale,
  prev,
  next,
}: {
  slug: string;
  locale: string;
  prev: { n: number; short: string } | null;
  next: { n: number; short: string } | null;
}) {
  const t = await getTranslations("reader");
  if (!prev && !next) return null;
  return (
    <nav className="pager" aria-label={t("pager")}>
      {prev ? (
        <Link
          href={chapterHref(slug, prev.n)}
          className="pager-link"
          rel="prev"
        >
          <span className="pager-dir">
            <ArrowLeftIcon aria-hidden="true" />
            {t("previous")}
          </span>
          <span className="pager-title" lang={locale}>
            <span className="pager-n">{chapterIndex(prev.n)}</span> {prev.short}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={chapterHref(slug, next.n)}
          className="pager-link pager-next"
          rel="next"
        >
          <span className="pager-dir">
            {t("next")}
            <ArrowRightIcon aria-hidden="true" />
          </span>
          <span className="pager-title" lang={locale}>
            <span className="pager-n">{chapterIndex(next.n)}</span> {next.short}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}

/**
 * Said once per page to a signed-out reader of an open book: the exercises
 * work, but progress is kept only after signing in (kit Notice). In the
 * interface's language, with its own lang.
 */
export async function SaveHint({
  path,
  locale,
}: {
  path: string;
  locale: string;
}) {
  const t = await getTranslations("progress");
  return (
    <Notice
      tone="info"
      className="save-hint"
      lang={locale}
      icon={<SignInIcon aria-hidden="true" />}
      title={t("signInToSave")}
      actions={
        <Button asChild size="sm" variant="outline">
          <a href={signInHref(path)}>
            <SignInIcon aria-hidden="true" />
            {t("signIn")}
          </a>
        </Button>
      }
    >
      {t("signInToSaveBody")}
    </Notice>
  );
}

/** The reading layout: contents aside on wide screens, the column beside it. */
export function ReaderLayout({
  aside,
  disclosure,
  style,
  children,
}: {
  aside: ReactNode;
  disclosure: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="reader og-container" style={style}>
      {aside}
      <div className="reader-main">
        {disclosure}
        {children}
      </div>
    </div>
  );
}
