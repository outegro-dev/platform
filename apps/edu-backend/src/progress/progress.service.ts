import { Inject, Injectable } from "@nestjs/common";
import type {
  AttemptResult,
  CardState,
  ExerciseAttempt,
  ExplainKind,
  ProgressResponse,
  positionSchema,
} from "@outegro/contracts/edu";
import { checkAttempt, InvalidAttempt } from "@outegro/edu-engine";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  type BookRow,
  CatalogService,
  type ChapterOutline,
} from "../books/catalog.service.js";
import type { EduDatabase, EduTx } from "../common/database.js";
import { EduMetrics } from "../common/metrics.js";
import { findExercise } from "../content/outline.js";
import {
  books,
  cardStatesTable,
  exerciseResults,
  readerDays,
  readerProgress,
  understandingChecks,
} from "../db/schema.js";
import { isReadable, type Viewer } from "../domain/access.js";
import { utcDay } from "../domain/calendar.js";
import {
  attemptFingerprint,
  recordAnswer,
  retryOf,
} from "../domain/progress.js";
import { mayWrite } from "../readers/account-lock.js";
import { knownCards, solvedExercises } from "./counts.js";

export type ProgressSummary = {
  exercisesSolved: number;
  cardsKnown: number;
  lastChapter: number | null;
};
type Position = z.infer<typeof positionSchema>;

/**
 * A reader's own progress in a book. Ownership is always the token's subject
 * (INV-10); a write counts only for a chapter the reader may open now. Reading
 * activity (an attempt, a card mark, a chapter reached, an assistant answer)
 * moves the reader's last activity and day of activity in the same
 * transaction; a preference (the favourite kind of explanation) does not.
 * Exercise answers are judged here, never by the client: the reader sends an
 * attempt, the book decides. Attempts and card marks with an Idempotency-Key
 * are safe to retry: the same key and body replay the stored outcome. Every
 * write checks the account again in its own transaction, under the reader's
 * account lock (account-lock.ts): a reader suspended or deleted since the
 * request began gets 403 and the assistant's records are skipped, so nothing
 * comes back after a deleted account's purge.
 */
@Injectable()
export class ProgressService {
  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly catalog: CatalogService,
    private readonly metrics: EduMetrics,
  ) {}

  /** Per book, for the library and the table of contents. */
  async summaries(
    userId: string,
    bookIds: readonly string[],
  ): Promise<Map<string, ProgressSummary>> {
    if (bookIds.length === 0) return new Map();
    const rows = await this.database.db
      .select({
        bookId: books.id,
        exercisesSolved: solvedExercises(userId, books.id),
        cardsKnown: knownCards(userId, books.id),
        lastChapter: readerProgress.lastChapter,
      })
      .from(books)
      .leftJoin(
        readerProgress,
        and(
          eq(readerProgress.bookId, books.id),
          eq(readerProgress.userId, userId),
        ),
      )
      .where(inArray(books.id, [...bookIds]));
    return new Map(rows.map(({ bookId, ...summary }) => [bookId, summary]));
  }

  async progress(viewer: Viewer, slug: string): Promise<ProgressResponse> {
    const userId = this.owner(viewer);
    const { book } = await this.catalog.visible(slug, viewer);
    const outline = await this.catalog.outline(book.id);
    const exerciseIds = new Set(outline.flatMap((c) => c.exerciseIds));
    const cardIds = new Set(outline.flatMap((c) => c.cardIds));
    const chapterNumbers = new Set(outline.map((c) => c.n));
    const db = this.database.db;
    const [position] = await db
      .select({
        lastChapter: readerProgress.lastChapter,
        explainView: readerProgress.explainView,
      })
      .from(readerProgress)
      .where(
        and(
          eq(readerProgress.userId, userId),
          eq(readerProgress.bookId, book.id),
        ),
      );
    const answers = await db
      .select({
        exerciseId: exerciseResults.exerciseId,
        solved: exerciseResults.solved,
      })
      .from(exerciseResults)
      .where(
        and(
          eq(exerciseResults.userId, userId),
          eq(exerciseResults.bookId, book.id),
        ),
      );
    const marks = await db
      .select({ cardId: cardStatesTable.cardId, state: cardStatesTable.state })
      .from(cardStatesTable)
      .where(
        and(
          eq(cardStatesTable.userId, userId),
          eq(cardStatesTable.bookId, book.id),
        ),
      );
    const checks = await db
      .select({
        chapter: understandingChecks.chapter,
        bestScore: understandingChecks.bestScore,
      })
      .from(understandingChecks)
      .where(
        and(
          eq(understandingChecks.userId, userId),
          eq(understandingChecks.bookId, book.id),
        ),
      );
    return {
      exercises: Object.fromEntries(
        answers
          .filter((answer) => exerciseIds.has(answer.exerciseId))
          .map((answer) => [answer.exerciseId, answer.solved]),
      ),
      cards: Object.fromEntries(
        marks
          .filter((mark) => cardIds.has(mark.cardId))
          .map((mark) => [mark.cardId, mark.state]),
      ),
      lastChapter: position?.lastChapter ?? null,
      explainView: position?.explainView ?? null,
      understanding: Object.fromEntries(
        checks
          .filter((check) => chapterNumbers.has(check.chapter))
          .map((check) => [String(check.chapter), check.bestScore]),
      ),
    };
  }

  /**
   * Judges an attempt against the book and records the outcome: every
   * attempt counts, solved stays solved whatever comes next. An attempt
   * that does not fit its exercise (another kind, an option or bucket the
   * exercise does not have) is refused with 400 and recorded nowhere. A
   * retry with the last attempt's Idempotency-Key and the same body gets
   * the stored outcome and changes nothing; another body with that key is
   * 409.
   */
  async attempt(
    viewer: Viewer,
    slug: string,
    exerciseId: string,
    attempt: ExerciseAttempt,
    key: string | null = null,
  ): Promise<AttemptResult> {
    const userId = this.owner(viewer);
    const { book, chapter } = await this.writable(viewer, slug, (entry) =>
      entry.exerciseIds.includes(exerciseId),
    );
    const document = await this.catalog.document(book.id, chapter.n);
    // Replaced by an import between the two reads.
    const exercise = document
      ? findExercise(document.blocks, exerciseId)
      : null;
    if (!exercise) throw new AppError("NOT_FOUND");
    let correct: boolean;
    try {
      correct = checkAttempt(exercise, attempt);
    } catch (error) {
      if (error instanceof InvalidAttempt)
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: { attempt: [error.reason] },
        });
      throw error;
    }
    const row = and(
      eq(exerciseResults.userId, userId),
      eq(exerciseResults.bookId, book.id),
      eq(exerciseResults.exerciseId, exerciseId),
    );
    const fingerprint = attemptFingerprint(attempt);
    const outcome = await this.database.db.transaction(async (tx) => {
      await this.requireWritable(tx, userId);
      const now = this.clock.now();
      // The row exists before it is locked, so concurrent attempts queue up
      // on it instead of racing to insert.
      await tx
        .insert(exerciseResults)
        .values({
          userId,
          bookId: book.id,
          exerciseId,
          solved: false,
          attempts: 0,
          firstSolvedAt: null,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const [previous] = await tx
        .select()
        .from(exerciseResults)
        .where(row)
        .for("update");
      const retry = retryOf(
        previous
          ? { key: previous.lastAttemptKey, body: previous.lastAttemptHash }
          : null,
        key,
        fingerprint,
      );
      if (retry === "conflict") throw new AppError("IDEMPOTENCY_CONFLICT");
      if (retry === "replay" && previous)
        return {
          replayed: true,
          correct: previous.lastCorrect ?? correct,
          solved: previous.solved,
        };
      const next = recordAnswer(previous ?? null, correct, now);
      await tx
        .update(exerciseResults)
        .set({
          ...next,
          lastAttemptKey: key,
          lastAttemptHash: fingerprint,
          lastCorrect: correct,
          updatedAt: now,
        })
        .where(row);
      await this.touch(tx, userId, book.id, now, {}, "activity");
      return { replayed: false, correct, solved: next.solved };
    });
    if (!outcome.replayed) this.metrics.progressSaved("exercise");
    return { correct: outcome.correct, solved: outcome.solved };
  }

  /** The reader's mark of a card; a retry with the same Idempotency-Key changes nothing. */
  async markCard(
    viewer: Viewer,
    slug: string,
    cardId: string,
    state: CardState,
    key: string | null = null,
  ): Promise<{ state: CardState }> {
    const userId = this.owner(viewer);
    const { book } = await this.writable(viewer, slug, (chapter) =>
      chapter.cardIds.includes(cardId),
    );
    const saved = await this.database.db.transaction(async (tx) => {
      await this.requireWritable(tx, userId);
      const now = this.clock.now();
      const [previous] = await tx
        .select({
          state: cardStatesTable.state,
          lastKey: cardStatesTable.lastKey,
        })
        .from(cardStatesTable)
        .where(
          and(
            eq(cardStatesTable.userId, userId),
            eq(cardStatesTable.bookId, book.id),
            eq(cardStatesTable.cardId, cardId),
          ),
        )
        .for("update");
      const retry = retryOf(
        previous ? { key: previous.lastKey, body: previous.state } : null,
        key,
        state,
      );
      if (retry === "conflict") throw new AppError("IDEMPOTENCY_CONFLICT");
      if (retry === "replay") return false;
      await tx
        .insert(cardStatesTable)
        .values({
          userId,
          bookId: book.id,
          cardId,
          state,
          lastKey: key,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            cardStatesTable.userId,
            cardStatesTable.bookId,
            cardStatesTable.cardId,
          ],
          set: { state, lastKey: key, updatedAt: now },
        });
      await this.touch(tx, userId, book.id, now, {}, "activity");
      return true;
    });
    if (saved) this.metrics.progressSaved("card");
    return { state };
  }

  /**
   * The reading position and the favourite kind of explanation; a chapter
   * must exist and be open to the reader. Reaching a chapter is reading
   * activity; changing only the preference is not.
   */
  async move(
    viewer: Viewer,
    slug: string,
    position: Position,
  ): Promise<{ lastChapter: number | null; explainView: ExplainKind | null }> {
    const userId = this.owner(viewer);
    const { lastChapter } = position;
    const book =
      lastChapter === undefined
        ? (await this.catalog.visible(slug, viewer)).book
        : (
            await this.writable(
              viewer,
              slug,
              (chapter) => chapter.n === lastChapter,
            )
          ).book;
    const stored = await this.database.db.transaction(async (tx) => {
      await this.requireWritable(tx, userId);
      return this.touch(
        tx,
        userId,
        book.id,
        this.clock.now(),
        position,
        lastChapter === undefined ? "preference" : "activity",
      );
    });
    this.metrics.progressSaved("position");
    return stored;
  }

  /**
   * An assistant answer about the book: reading activity, nothing else.
   * Nothing at all once the account is no longer active (the answer may
   * have streamed across a suspension or a purge).
   */
  async recordActivity(userId: string, bookId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      if (!(await mayWrite(tx, userId))) return;
      await this.touch(tx, userId, bookId, this.clock.now(), {}, "activity");
    });
  }

  /**
   * The assistant's score of the reader's retelling of a chapter: the best
   * one stays, the last one and the number of checks are kept too. The
   * caller has checked that the chapter is open to the reader. Nothing is
   * kept once the account is no longer active.
   */
  async recordUnderstanding(
    userId: string,
    bookId: string,
    chapter: number,
    score: number,
  ): Promise<void> {
    const saved = await this.database.db.transaction(async (tx) => {
      if (!(await mayWrite(tx, userId))) return false;
      const now = this.clock.now();
      await tx
        .insert(understandingChecks)
        .values({
          userId,
          bookId,
          chapter,
          bestScore: score,
          lastScore: score,
          checks: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            understandingChecks.userId,
            understandingChecks.bookId,
            understandingChecks.chapter,
          ],
          set: {
            bestScore: sql`greatest(${understandingChecks.bestScore}, ${score})`,
            lastScore: score,
            checks: sql`${understandingChecks.checks} + 1`,
            updatedAt: now,
          },
        });
      await this.touch(tx, userId, bookId, now, {}, "activity");
      return true;
    });
    if (saved) this.metrics.progressSaved("understanding");
  }

  /** Readers only ever write their own progress: the token's subject. */
  private owner(viewer: Viewer): string {
    if (!viewer.userId) throw new AppError("UNAUTHENTICATED");
    return viewer.userId;
  }

  /**
   * 403 when the account was suspended or deleted after the request was
   * checked; the account cannot change until the write commits.
   */
  private async requireWritable(tx: EduTx, userId: string): Promise<void> {
    if (!(await mayWrite(tx, userId))) throw new AppError("FORBIDDEN");
  }

  /**
   * The book and chapter of a write, if the chapter it touches is there:
   * 404 when the book or no chapter of it matches (an id that is not the
   * book's), 403 when that chapter is not open to the viewer now.
   */
  private async writable(
    viewer: Viewer,
    slug: string,
    matches: (chapter: ChapterOutline) => boolean,
  ): Promise<{ book: BookRow; chapter: ChapterOutline }> {
    const { book, policy } = await this.catalog.visible(slug, viewer);
    const chapter = (await this.catalog.outline(book.id)).find(matches);
    if (!chapter) throw new AppError("NOT_FOUND");
    const access = policy.chapter(viewer, chapter.n);
    if (!isReadable(access))
      throw new AppError("FORBIDDEN", { fieldErrors: { access: [access] } });
    return { book, chapter };
  }

  /**
   * The reader's row in the book (created by the first write) with the
   * position fields given. Activity also moves the last activity and marks
   * today; a preference alone leaves both as they were.
   */
  private async touch(
    tx: EduTx,
    userId: string,
    bookId: string,
    now: Date,
    position: Position,
    kind: "activity" | "preference",
  ) {
    const fields = {
      ...(position.lastChapter === undefined
        ? {}
        : { lastChapter: position.lastChapter }),
      ...(position.explainView === undefined
        ? {}
        : { explainView: position.explainView }),
    };
    const [stored] = await tx
      .insert(readerProgress)
      .values({
        userId,
        bookId,
        ...fields,
        startedAt: now,
        lastActiveAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [readerProgress.userId, readerProgress.bookId],
        set: {
          ...fields,
          ...(kind === "activity" ? { lastActiveAt: now } : {}),
          updatedAt: now,
        },
      })
      .returning({
        lastChapter: readerProgress.lastChapter,
        explainView: readerProgress.explainView,
      });
    if (kind === "activity")
      await tx
        .insert(readerDays)
        .values({ userId, day: utcDay(now) })
        .onConflictDoNothing();
    return {
      lastChapter: stored?.lastChapter ?? null,
      explainView: stored?.explainView ?? null,
    };
  }
}
