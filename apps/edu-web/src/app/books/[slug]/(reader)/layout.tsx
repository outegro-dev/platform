import { notFound } from "next/navigation";
import { isBookSlug, loadBook } from "@/lib/api";
import { isPrefetch } from "@/lib/request";
import "./reader.css";

/**
 * The reading routes (chapters, the preface, the deck): only they load the
 * reading styles, and an unknown book answers a real 404. The book is
 * resolved here, outside the pages' loading skeletons (each page segment
 * has its own loading.tsx below this layout), so the status is still free
 * to set; the pages reuse the same answer (React's request cache) and load
 * the rest themselves (ReaderFrame).
 */
export default async function ReaderRoutesLayout({
  params,
  children,
}: LayoutProps<"/books/[slug]">) {
  const { slug } = await params;
  if (!isBookSlug(slug)) notFound();
  if (!(await isPrefetch())) {
    const book = await loadBook(slug);
    if (book.status === "not-found") notFound();
  }
  return children;
}
