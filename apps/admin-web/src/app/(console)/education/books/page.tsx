import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BooksTable } from "@/components/education/books-table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { pageAccess } from "@/lib/access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("education.books");
  return { title: t("title") };
}

export default async function BooksPage() {
  const access = await pageAccess("edu.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("education.books");
  return (
    <Suspense
      fallback={
        <TableSkeleton label={t("title")} rows={2} withFilters={false} />
      }
    >
      <BooksTable title={t("title")} note={t("lead")} />
    </Suspense>
  );
}
