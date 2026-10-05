import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Pager } from "@/components/ui/data";
import { Panel } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import type { ReaderFilter } from "@/lib/adapters/edu";
import { educationBooks } from "@/lib/queries";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { ReaderProgressTable } from "./reader-progress";

/**
 * Readers' progress, most recently active first: one row per reader and
 * book, each reader a short ID that opens the user card (no name lookups).
 */
export async function ReadersTable({
  filter,
  title,
  pager = true,
  limit = 25,
  showBook = true,
  action,
}: {
  filter: ReaderFilter;
  title: string;
  pager?: boolean;
  limit?: number;
  /** Off on a book's own page, where every row is that book. */
  showBook?: boolean;
  action?: ReactNode;
}) {
  const t = await getTranslations("education.readers");
  const [result, books] = await Promise.all([
    load(() => services().education.readers({ ...filter, limit })),
    educationBooks(),
  ]);
  if (!result.ok) {
    return (
      <Panel
        title={title}
        action={action}
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
  const { items, nextCursor } = result.data;
  if (items.length === 0) {
    return (
      <Panel title={title} action={action}>
        <EmptyState
          size="sm"
          search={Boolean(filter.book || filter.userId)}
          title={t("empty")}
          body={t("emptyBody")}
        />
      </Panel>
    );
  }
  const titles = new Map(
    books.ok ? books.data.map((book) => [book.slug, book.title]) : [],
  );
  return (
    <Panel flush title={title} action={action}>
      <ReaderProgressTable
        title={title}
        rows={items}
        lead="reader"
        showBook={showBook}
        bookTitle={(slug) => titles.get(slug) ?? slug}
      />
      {pager && (
        <Pager
          path="/education/readers"
          params={{
            book: filter.book,
            userId: filter.userId,
            cursor: filter.cursor,
          }}
          nextCursor={nextCursor}
          shown={items.length}
        />
      )}
    </Panel>
  );
}
