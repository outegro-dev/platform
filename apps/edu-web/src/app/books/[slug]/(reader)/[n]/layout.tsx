import { notFound } from "next/navigation";
import { chapterNumber, loadBook } from "@/lib/api";
import { isPrefetch } from "@/lib/request";

/**
 * A chapter: a number the book does not have answers a real 404. Checked
 * here, above the chapter's loading skeleton, against the contents the
 * reading layout already loaded (the same cached answer, no second call).
 * When the book did not load, the page explains that instead.
 */
export default async function ChapterLayout({
  params,
  children,
}: LayoutProps<"/books/[slug]/[n]">) {
  const { slug, n } = await params;
  const number = chapterNumber(n);
  if (number === null) notFound();
  if (!(await isPrefetch())) {
    const book = await loadBook(slug);
    if (
      book.status === "ok" &&
      !book.data.chapters.some((chapter) => chapter.n === number)
    )
      notFound();
  }
  return children;
}
