import { notFound } from "next/navigation";
import { isBookSlug, loadBook } from "@/lib/api";
import { isPrefetch } from "@/lib/request";

/**
 * The book page: an unknown book answers a real 404. This layout sits
 * outside the page's loading skeleton (loading.tsx nests inside it), so
 * the book is resolved before anything streams and the status is still
 * free to set; the page reuses the same answer (React's request cache).
 */
export default async function BookLayout({
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
