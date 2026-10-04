import { getTranslations } from "next-intl/server";
import { ReaderSkeleton } from "@/components/skeletons";

/**
 * The deck while it loads: the reader's frame, drawn.
 * Below the layouts that check the book (and the chapter), so an unknown
 * one still answers 404 before this streams.
 */
export default async function ReaderLoading() {
  const t = await getTranslations("reader");
  return (
    <main id="main" className="app-main app-main-tall reader-page">
      <ReaderSkeleton label={t("loading")} />
    </main>
  );
}
