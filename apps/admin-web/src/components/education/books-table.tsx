import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataTable, Time } from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import { getLabels } from "@/lib/labels";
import { educationBooks } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { toneOf } from "@/lib/tones";
import { getRuleWords } from "./access-rule";

/** Every book with its status, who reads it and how many do. */
export async function BooksTable({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  const t = await getTranslations("education.books");
  const label = await getLabels();
  const f = await getFormatter();
  const words = await getRuleWords();
  const result = await educationBooks();
  if (!result.ok) {
    return (
      <Panel
        title={title}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const books = result.data;
  if (books.length === 0) {
    return (
      <Panel title={title} note={note}>
        <EmptyState size="sm" title={t("empty")} body={t("emptyBody")} />
      </Panel>
    );
  }
  return (
    <Panel flush id="books" title={title} note={note}>
      <DataTable label={title}>
        <thead>
          <tr>
            <th scope="col">{t("colBook")}</th>
            <th scope="col">{t("colStatus")}</th>
            <th scope="col">{t("colAccess")}</th>
            <th scope="col" className="num">
              {t("colReaders")}
            </th>
            <th scope="col">{t("colContent")}</th>
            <th scope="col">{t("colPublished")}</th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => {
            const rule = words(book.rule, book.slug);
            return (
              <tr key={book.slug}>
                <td data-primary="">
                  <Link
                    href={`/education/books/${book.slug}`}
                    className="row-link cell-main"
                    prefetch={false}
                  >
                    {book.title}
                  </Link>
                  <span className="cell-sub mono">{book.slug}</span>
                </td>
                <td data-label={t("colStatus")}>
                  <Status tone={toneOf("book", book.status)}>
                    {label("bookStatus", book.status)}
                  </Status>
                </td>
                {/* Wrapped, so a phone card keeps a value and its line together. */}
                <td data-label={t("colAccess")}>
                  <span>
                    {rule.title}
                    <span className="cell-sub">{rule.summary}</span>
                  </span>
                </td>
                <td data-label={t("colReaders")} className="num">
                  {f.number(book.readers)}
                </td>
                <td data-label={t("colContent")}>
                  <span>
                    <span className="mono">
                      {t("version", { version: book.contentVersion })}
                    </span>
                    <span className="cell-sub">
                      {t("imported")}{" "}
                      <Time iso={book.importedAt} format="date" />
                    </span>
                  </span>
                </td>
                <td data-label={t("colPublished")}>
                  {book.publishedAt ? (
                    <Time iso={book.publishedAt} format="date" />
                  ) : (
                    <span className="muted">{t("never")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </Panel>
  );
}
