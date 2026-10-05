import { Inject, Injectable } from "@nestjs/common";
import type {
  BookResponse,
  BookSummary,
  ChapterAccess,
  ChapterResponse,
  DeckResponse,
  LibraryResponse,
  PrefaceResponse,
} from "@outegro/contracts/edu";
import { AppError, DATABASE } from "@outegro/nest-common";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { EduDatabase } from "../common/database.js";
import { EduMetrics } from "../common/metrics.js";
import { usesSandbox } from "../content/outline.js";
import { chapters } from "../db/schema.js";
import { BookPolicy, isReadable, type Viewer } from "../domain/access.js";
import {
  ProgressService,
  type ProgressSummary,
} from "../progress/progress.service.js";
import { type BookRow, CatalogService } from "./catalog.service.js";

/**
 * The reader API: library, table of contents, chapters, preface and deck,
 * each after the access check. Reading never changes progress, so prefetched
 * chapters do not move the reader's place.
 */
@Injectable()
export class LibraryService {
  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    private readonly catalog: CatalogService,
    private readonly progress: ProgressService,
    private readonly metrics: EduMetrics,
  ) {}

  async library(viewer: Viewer): Promise<LibraryResponse> {
    const rows = await this.catalog.list(viewer);
    const progress = await this.progressOf(
      viewer,
      rows.map((book) => book.id),
    );
    return {
      books: rows.map((book) =>
        this.summary(book, viewer, progress?.get(book.id)),
      ),
    };
  }

  async book(viewer: Viewer, slug: string): Promise<BookResponse> {
    const { book, policy } = await this.catalog.visible(slug, viewer);
    const outline = await this.catalog.outline(book.id);
    const progress = await this.progressOf(viewer, [book.id]);
    const { preface, deck, note, sandbox } = book.meta;
    return {
      book: this.summary(book, viewer, progress?.get(book.id)),
      chapters: outline.map((chapter) => ({
        n: chapter.n,
        id: chapter.key,
        short: chapter.short,
        title: chapter.title,
        sections: chapter.sections,
        exercises: chapter.exerciseIds.length,
        cards: chapter.cardIds.length,
        access: policy.chapter(viewer, chapter.n),
      })),
      preface: preface
        ? { id: preface.id, kicker: preface.kicker, title: preface.title }
        : null,
      deck,
      note: note ?? null,
      hasSandbox: sandbox !== undefined,
    };
  }

  /** 401 when the reader must sign in first, 403 when a grant is missing. */
  async chapter(
    viewer: Viewer,
    slug: string,
    n: number,
  ): Promise<ChapterResponse> {
    const { book, policy } = await this.catalog.visible(slug, viewer);
    const outline = await this.catalog.outline(book.id);
    const index = outline.findIndex((chapter) => chapter.n === n);
    const entry = outline[index];
    if (!entry) throw new AppError("NOT_FOUND");
    const access = this.requireReadable(policy.chapter(viewer, n));
    const [row] = await this.database.db
      .select({ document: chapters.document })
      .from(chapters)
      .where(and(eq(chapters.bookId, book.id), eq(chapters.n, n)));
    // Replaced by an import between the two reads.
    if (!row) throw new AppError("NOT_FOUND");
    const neighbour = (i: number) => {
      const chapter = outline[i];
      return chapter ? { n: chapter.n, short: chapter.short } : null;
    };
    const { eventLoop, sandbox } = book.meta;
    return {
      book: this.ref(book),
      chapter: row.document,
      access,
      prev: neighbour(index - 1),
      next: neighbour(index + 1),
      eventLoop:
        entry.usesEventLoop && eventLoop
          ? { scenarios: eventLoop.scenarios }
          : null,
      sandbox: entry.usesSandbox && sandbox ? sandbox : null,
    };
  }

  /** The introduction before chapter 1, with the access of chapter 1. */
  async preface(viewer: Viewer, slug: string): Promise<PrefaceResponse> {
    const { book, policy } = await this.catalog.visible(slug, viewer);
    const { preface, sandbox } = book.meta;
    if (!preface) throw new AppError("NOT_FOUND");
    this.requireReadable(policy.chapter(viewer, 1));
    return {
      book: this.ref(book),
      preface,
      sandbox: sandbox && usesSandbox(preface.blocks) ? sandbox : null,
    };
  }

  /** Cards of the chapters the reader may open; the rest are only counted. */
  async deck(viewer: Viewer, slug: string): Promise<DeckResponse> {
    const { book, policy } = await this.catalog.visible(slug, viewer);
    const outline = await this.catalog.outline(book.id);
    const readable = outline.filter((chapter) =>
      isReadable(policy.chapter(viewer, chapter.n)),
    );
    const lockedCards = outline
      .filter((chapter) => !readable.includes(chapter))
      .reduce((sum, chapter) => sum + chapter.cardIds.length, 0);
    const withCards = readable.filter((chapter) => chapter.cardIds.length > 0);
    const rows =
      withCards.length === 0
        ? []
        : await this.database.db
            .select({ n: chapters.n, cards: chapters.cards })
            .from(chapters)
            .where(
              and(
                eq(chapters.bookId, book.id),
                inArray(
                  chapters.n,
                  withCards.map((chapter) => chapter.n),
                ),
              ),
            )
            .orderBy(asc(chapters.n));
    return {
      book: this.ref(book),
      chapters: rows.map((row) => ({
        n: row.n,
        short: outline.find((chapter) => chapter.n === row.n)?.short ?? "",
        cards: row.cards,
      })),
      lockedCards,
    };
  }

  private requireReadable(access: ChapterAccess): ChapterAccess {
    this.metrics.chapterRequested(access);
    if (access === "sign_in")
      throw new AppError("UNAUTHENTICATED", {
        fieldErrors: { access: [access] },
      });
    if (!isReadable(access))
      throw new AppError("FORBIDDEN", { fieldErrors: { access: [access] } });
    return access;
  }

  private progressOf(viewer: Viewer, bookIds: string[]) {
    return viewer.userId
      ? this.progress.summaries(viewer.userId, bookIds)
      : Promise.resolve(null);
  }

  private summary(
    book: BookRow,
    viewer: Viewer,
    progress: ProgressSummary | undefined,
  ): BookSummary {
    const policy = new BookPolicy(book.status, book.rule);
    const { kicker, lead, cover, theme, stats } = book.meta;
    return {
      slug: book.slug,
      title: book.title,
      kicker,
      lead,
      cover,
      theme,
      locale: book.locale,
      stats,
      status: book.status,
      contentVersion: book.contentVersion,
      access: policy.book(viewer),
      features: policy.features,
      previewChapters: policy.previewChapters,
      // Signed in: zeros before the first write; signed out: none.
      progress: viewer.signedIn
        ? (progress ?? {
            exercisesSolved: 0,
            cardsKnown: 0,
            lastChapter: null,
          })
        : null,
    };
  }

  private ref(book: BookRow) {
    return {
      slug: book.slug,
      title: book.title,
      contentVersion: book.contentVersion,
      theme: book.meta.theme,
      locale: book.locale,
    };
  }
}
