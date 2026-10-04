import { Inject, Injectable } from "@nestjs/common";
import { bookSlugSchema, type Chapter } from "@outegro/contracts/edu";
import { AppError, DATABASE } from "@outegro/nest-common";
import { and, asc, eq } from "drizzle-orm";
import type { EduDatabase } from "../common/database.js";
import { books, type ChapterSection, chapters } from "../db/schema.js";
import { BookPolicy, type Viewer } from "../domain/access.js";

export type BookRow = typeof books.$inferSelect;

/** What the reader API knows about a chapter without loading its document. */
export type ChapterOutline = {
  n: number;
  key: string;
  short: string;
  title: string;
  sections: ChapterSection[];
  exerciseIds: string[];
  cardIds: string[];
  usesEventLoop: boolean;
  usesSandbox: boolean;
};

/** Books and their chapters as imported; access rules live in BookPolicy. */
@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly database: EduDatabase) {}

  /** Any status; null for an unknown or malformed slug. */
  async find(slug: string): Promise<BookRow | null> {
    if (!bookSlugSchema.safeParse(slug).success) return null;
    const [row] = await this.database.db
      .select()
      .from(books)
      .where(eq(books.slug, slug));
    return row ?? null;
  }

  /** The book if the viewer may see it at all; 404 otherwise, drafts included. */
  async visible(
    slug: string,
    viewer: Viewer,
  ): Promise<{ book: BookRow; policy: BookPolicy }> {
    const book = await this.find(slug);
    if (!book) throw new AppError("NOT_FOUND");
    const policy = new BookPolicy(book.status, book.rule);
    if (!policy.visibleTo(viewer)) throw new AppError("NOT_FOUND");
    return { book, policy };
  }

  /** Published books, every book for staff, in the order they were imported. */
  async list(viewer: Viewer): Promise<BookRow[]> {
    const rows = await this.database.db
      .select()
      .from(books)
      .orderBy(asc(books.createdAt), asc(books.slug));
    return rows.filter((book) =>
      new BookPolicy(book.status, book.rule).visibleTo(viewer),
    );
  }

  /** One chapter's document; null when an import replaced the book meanwhile. */
  async document(bookId: string, n: number): Promise<Chapter | null> {
    const [row] = await this.database.db
      .select({ document: chapters.document })
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), eq(chapters.n, n)));
    return row?.document ?? null;
  }

  /** The chapters of a book in order, without their documents. */
  outline(bookId: string): Promise<ChapterOutline[]> {
    return this.database.db
      .select({
        n: chapters.n,
        key: chapters.key,
        short: chapters.short,
        title: chapters.title,
        sections: chapters.sections,
        exerciseIds: chapters.exerciseIds,
        cardIds: chapters.cardIds,
        usesEventLoop: chapters.usesEventLoop,
        usesSandbox: chapters.usesSandbox,
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.n));
  }
}
