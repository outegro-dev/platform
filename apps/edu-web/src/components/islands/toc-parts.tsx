"use client";

import { isUnderstood } from "@outegro/edu-engine";
import { SealCheckIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef } from "react";
import { useOptionalReaderStores } from "@/stores/provider";

/*
 * The live parts of the book's contents on a reading page: the section in
 * view, cards known, chapters understood, and the folded contents on
 * phones that close once a link in them is chosen. Without the page's
 * stores (or signed out) they show what the server knew. They speak the
 * interface's language: the contents sit outside the book's own messages.
 */

/**
 * The folded contents (phones, tablets): a link chosen in it closes it
 * before the page moves on, so a section link lands where it points and
 * the next chapter does not open with the contents spread over it.
 */
export function TocDetails({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    // Before the link acts: the jump to a section then measures the page
    // with the contents already folded.
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest("a")) details.open = false;
    };
    details.addEventListener("click", close);
    return () => details.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}

/** The current chapter's sections; the one being read is marked as the location. */
export const TocSections = observer(function TocSections({
  sections,
  locale,
  label,
}: {
  sections: { id: string; title: string }[];
  locale: string;
  label: string;
}) {
  "use no memo";
  const stores = useOptionalReaderStores();
  const current = stores?.sections.current ?? null;
  return (
    <ol className="toc-sections" aria-label={label}>
      {sections.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            lang={locale}
            aria-current={current === section.id ? "location" : undefined}
          >
            {section.title}
          </a>
        </li>
      ))}
    </ol>
  );
});

/**
 * "12/122" next to the flash cards: cards marked "I know it" of the whole
 * book, said in words to a screen reader.
 */
export const TocDeckProgress = observer(function TocDeckProgress({
  slug,
  total,
  initial,
}: {
  slug: string;
  total: number;
  initial: number;
}) {
  "use no memo";
  const stores = useOptionalReaderStores();
  const t = useTranslations("reader");
  const known = Math.min(
    total,
    stores && stores.slug === slug && stores.signedIn
      ? stores.progress.cardsKnown
      : initial,
  );
  return (
    <span
      className="toc-progress"
      data-done={(total > 0 && known === total) || undefined}
    >
      <span aria-hidden="true">
        {known}/{total}
      </span>
      <span className="sr-only">, {t("cardsKnown", { known, total })}</span>
    </span>
  );
});

/**
 * A chapter the reader explained in their own words well enough (a best
 * score of 7 or more): a small seal next to it. Its place is kept, so a
 * score that comes in while reading moves nothing.
 */
export const TocUnderstood = observer(function TocUnderstood({
  slug,
  n,
  initial,
  label,
}: {
  slug: string;
  n: number;
  initial: boolean;
  label: string;
}) {
  "use no memo";
  const stores = useOptionalReaderStores();
  const on =
    stores && stores.slug === slug && stores.signedIn
      ? isUnderstood(stores.progress.understandingOf(n))
      : initial;
  return (
    <span className="toc-understood" data-on={on || undefined}>
      <SealCheckIcon aria-hidden="true" weight="fill" />
      {on ? <span className="sr-only">, {label}</span> : null}
    </span>
  );
});
