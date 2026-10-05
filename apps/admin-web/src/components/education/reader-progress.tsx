import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataTable, Time } from "@/components/ui/data";
import { Status } from "@/components/ui/layout";
import type { ReaderView } from "@/lib/adapters/edu";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { getFormatter } from "@/lib/request";
import { toneOf } from "@/lib/tones";

/**
 * Reading progress, one row per reader and book: exercises solved, cards
 * known, the last chapter, access and activity. The section's lists lead
 * with the reader's short ID, the row a link to the user card where the
 * name is, like the console's other lists of users: a list never asks
 * Identity for a name per row (it allows an operator 120 requests a minute;
 * `<Actor>` is for the few operators of an audit feed). A user's card leads
 * with the book, the row a link to its page.
 */
export async function ReaderProgressTable({
  title,
  rows,
  lead,
  bookTitle,
  showBook = true,
}: {
  title: string;
  rows: readonly ReaderView[];
  lead: "reader" | "book";
  /** A book's title by slug (the slug itself while the list cannot be read). */
  bookTitle: (slug: string) => string;
  /** With the reader first: a column with the book, off on a book's own page. */
  showBook?: boolean;
}) {
  const t = await getTranslations("education.readers");
  const label = await getLabels();
  const f = await getFormatter();
  const bookColumn = lead === "reader" && showBook;
  const share = (part: number, whole: number) =>
    whole > 0 ? f.percent(part / whole) : "—";
  const bookHref = (slug: string) =>
    `/education/books/${encodeURIComponent(slug)}`;
  return (
    <DataTable label={title}>
      <thead>
        <tr>
          <th scope="col">
            {lead === "reader" ? t("colReader") : t("colBook")}
          </th>
          {bookColumn && <th scope="col">{t("colBook")}</th>}
          <th scope="col" className="num">
            {t("colExercises")}
          </th>
          <th scope="col" className="num">
            {t("colCards")}
          </th>
          <th scope="col" className="num">
            {t("colChapter")}
          </th>
          <th scope="col">{t("colAccess")}</th>
          <th scope="col">{t("colActive")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((reader) => (
          <tr key={`${reader.userId}-${reader.book}`}>
            <td data-primary="">
              {/* Either way the row is the link (a 44 px target and more). */}
              {lead === "reader" ? (
                <Link
                  href={`/users/${encodeURIComponent(reader.userId)}`}
                  className="row-link mono cell-main"
                  prefetch={false}
                >
                  {shortId(reader.userId)}
                </Link>
              ) : (
                <Link
                  href={bookHref(reader.book)}
                  className="row-link cell-main"
                  prefetch={false}
                >
                  {bookTitle(reader.book)}
                </Link>
              )}
              <span className="cell-sub">
                {t("started")} <Time iso={reader.startedAt} format="date" />
              </span>
            </td>
            {bookColumn && (
              <td data-label={t("colBook")}>
                <Link
                  href={bookHref(reader.book)}
                  className="link above"
                  prefetch={false}
                >
                  {bookTitle(reader.book)}
                </Link>
              </td>
            )}
            {/* One wrapper per cell: a phone card keeps value and share together. */}
            <td data-label={t("colExercises")} className="num">
              <span>
                {f.number(reader.exercisesSolved)} /{" "}
                {f.number(reader.exercisesTotal)}
                <span className="cell-sub">
                  {share(reader.exercisesSolved, reader.exercisesTotal)}
                </span>
              </span>
            </td>
            <td data-label={t("colCards")} className="num">
              <span>
                {f.number(reader.cardsKnown)} / {f.number(reader.cardsTotal)}
                <span className="cell-sub">
                  {share(reader.cardsKnown, reader.cardsTotal)}
                </span>
              </span>
            </td>
            <td data-label={t("colChapter")} className="num">
              {reader.lastChapter ?? <span className="muted">—</span>}
            </td>
            <td data-label={t("colAccess")}>
              <Status tone={toneOf("readerAccess", reader.access)}>
                {label("readerAccess", reader.access)}
              </Status>
            </td>
            <td data-label={t("colActive")}>
              <Time iso={reader.lastActiveAt} format="relative" />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
