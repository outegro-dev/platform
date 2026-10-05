import { getTranslations } from "next-intl/server";
import { BookCard } from "@/components/library/book-card";
import { Unavailable } from "@/components/reader/unavailable";
import { loadLibrary } from "@/lib/api";

/** The library: every book the reader can see, with access and progress. */
export default async function LibraryPage() {
  const t = await getTranslations("library");
  const library = await loadLibrary();
  return (
    <main id="main" className="app-main app-main-tall og-container">
      <header className="page-head">
        <p className="og-eyebrow">{t("eyebrow")}</p>
        <h1>
          {t("title")} <span className="og-accent">{t("titleAccent")}</span>
        </h1>
        <p>{t("lead")}</p>
      </header>
      {library.status === "ok" ? (
        <section aria-labelledby="books-title">
          <h2 id="books-title" className="sr-only">
            {t("booksTitle")}
          </h2>
          {library.data.books.length ? (
            <ul className="book-grid">
              {library.data.books.map((book) => (
                <li key={book.slug}>
                  <BookCard book={book} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">{t("empty")}</p>
          )}
        </section>
      ) : (
        <Unavailable
          title={t("unavailableTitle")}
          body={t("unavailableBody")}
          retry={t("retry")}
          href="/"
        />
      )}
    </main>
  );
}
