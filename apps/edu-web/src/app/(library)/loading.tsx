import { getTranslations } from "next-intl/server";
import { LibrarySkeleton } from "@/components/skeletons";

/** The library while the books load: the real heading, the cards' shapes. */
export default async function LibraryLoading() {
  const t = await getTranslations("library");
  return (
    <main id="main" className="app-main app-main-tall og-container">
      <header className="page-head">
        <p className="og-eyebrow">{t("eyebrow")}</p>
        <h1>
          {t("title")} <span className="og-accent">{t("titleAccent")}</span>
        </h1>
        <p>{t("lead")}</p>
      </header>
      <LibrarySkeleton label={t("loading")} />
    </main>
  );
}
