import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BoardView } from "@/components/board/board-view";
import { StatsStrip } from "@/components/board/stats-strip";
import { Unavailable } from "@/components/ui/states";
import { loadBoard } from "@/lib/api";
import { parseFilters } from "@/lib/board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("board");
  return { title: t("title") };
}

/** The board: the funnel left to right, everything that waits on the owner in view. */
export default async function BoardPage({ searchParams }: PageProps<"/">) {
  const t = await getTranslations("board");
  const [loaded, params] = await Promise.all([loadBoard(), searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (typeof value === "string") query.set(key, value);
  return (
    <main id="main" className="page page-board">
      <header className="page-head board-head">
        <h1>{t("title")}</h1>
        {loaded.status === "ok" ? (
          <StatsStrip stats={loaded.data.stats} />
        ) : null}
      </header>
      {loaded.status === "ok" ? (
        <BoardView
          board={loaded.data}
          now={Date.now()}
          initialFilters={parseFilters(query)}
        />
      ) : (
        <Unavailable retryHref="/" />
      )}
    </main>
  );
}
