"use client";

import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useOptionalReaderStores } from "@/stores/provider";

/**
 * "3/6" next to a chapter in the contents, said in words to a screen
 * reader (", 3 of 6 solved", in the interface language). It follows the
 * reader's progress on the page (an exercise the server confirms as
 * solved here counts at once); without the page's stores it shows what the
 * server knew.
 */
export const TocProgress = observer(function TocProgress({
  slug,
  chapterId,
  total,
  initial,
}: {
  slug: string;
  chapterId: string;
  total: number;
  initial: number;
}) {
  "use no memo";
  const stores = useOptionalReaderStores();
  const t = useTranslations("reader");
  const solved =
    stores && stores.slug === slug && stores.signedIn
      ? stores.progress.solvedIn(chapterId)
      : initial;
  return (
    <span className="toc-progress" data-done={solved === total || undefined}>
      <span aria-hidden="true">
        {solved}/{total}
      </span>
      <span className="sr-only">, {t("solvedCount", { solved, total })}</span>
    </span>
  );
});
