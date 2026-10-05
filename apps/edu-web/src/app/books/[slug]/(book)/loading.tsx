import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookSkeleton } from "@/components/skeletons";

/** A book page while it loads: the way back is real, the rest its shape. */
export default async function BookLoading() {
  const t = await getTranslations("bookPage");
  return (
    <main id="main" className="app-main app-main-tall og-container book-page">
      <Link href="/" className="back-link">
        <ArrowLeftIcon aria-hidden="true" />
        {t("breadcrumb")}
      </Link>
      <BookSkeleton label={t("loading")} />
    </main>
  );
}
