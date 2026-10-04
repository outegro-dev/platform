import { Inject, Injectable } from "@nestjs/common";
import {
  type AdminAuditEntry,
  type AdminBook,
  type AdminBookDetail,
  type AdminOverview,
  type AdminReader,
  type AdminUserEducation,
  type adminAuditQuerySchema,
  type adminReadersQuerySchema,
  type BookStats,
  type bookCommandResultSchema,
  bookSlugSchema,
  type SetBookAccess,
  type SetBookStatus,
} from "@outegro/contracts/edu";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { AssistLedger } from "../assist/ledger.js";
import { AssistSettings } from "../assist/settings.js";
import { decodeCursor, toPage } from "../common/cursor.js";
import type { EduDatabase, EduTx } from "../common/database.js";
import { qualified as q } from "../common/sql.js";
import {
  adminAudit,
  assistUsage,
  books,
  chapters,
  exerciseResults,
  grants,
  readerDays,
  readerProgress,
} from "../db/schema.js";
import { BookPolicy, grantInForce } from "../domain/access.js";
import {
  type BookChange,
  BookCommands,
  CommandRefused,
} from "../domain/book-commands.js";
import { lastDays, utcDay } from "../domain/calendar.js";
import {
  cardTotal,
  exerciseTotal,
  knownCards,
  solvedExercises,
} from "../progress/counts.js";

type Actor = { userId: string };
type BookCommandResult = z.infer<typeof bookCommandResultSchema>;
type LockedBook = Pick<
  typeof books.$inferSelect,
  "id" | "slug" | "status" | "rule" | "version"
>;

const DAY_MS = 24 * 3600_000;
/** The overview's activity chart: readers per UTC day, today included. */
const ACTIVITY_DAYS = 14;

/**
 * The education side of the admin console: books with their readers, access
 * and audit. Status and rule change only through versioned commands that
 * commit together with their audit row (INV-22).
 */
@Injectable()
export class AdminService {
  private readonly commands = new BookCommands();

  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly assist: AssistSettings,
    private readonly ledger: AssistLedger,
  ) {}

  async overview(): Promise<AdminOverview> {
    const now = this.clock.now();
    const db = this.database.db;
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const statuses = await db
      .select({ status: books.status, value: count() })
      .from(books)
      .groupBy(books.status);
    const [readers] = await db
      .select({
        total: sql<number>`count(distinct ${readerProgress.userId})::int`,
        active7d: sql<number>`(count(distinct ${readerProgress.userId}) filter (where ${readerProgress.lastActiveAt} >= ${weekAgo.toISOString()}::timestamptz))::int`,
      })
      .from(readerProgress);
    const [inForce] = await db
      .select({ value: count() })
      .from(grants)
      .where(
        and(
          eq(grants.state, "active"),
          lte(grants.validFrom, now),
          or(isNull(grants.validUntil), gt(grants.validUntil, now)),
        ),
      );
    const [solved] = await db
      .select({ value: count() })
      .from(exerciseResults)
      .where(gte(exerciseResults.firstSolvedAt, weekAgo));
    const days = lastDays(now, ACTIVITY_DAYS);
    const active = await db
      .select({ day: readerDays.day, readers: count() })
      .from(readerDays)
      .where(
        and(
          gte(
            readerDays.day,
            utcDay(new Date(now.getTime() - (ACTIVITY_DAYS - 1) * DAY_MS)),
          ),
          lte(readerDays.day, utcDay(now)),
        ),
      )
      .groupBy(readerDays.day);
    // The assistant over the week: every request, cached or not; failed is
    // any that did not end with a full answer.
    const [assist] = await db
      .select({
        requests: count(),
        cached: sql<number>`(count(*) filter (where ${assistUsage.cached}))::int`,
        failed: sql<number>`(count(*) filter (where ${assistUsage.outcome} <> 'ok'))::int`,
        tokensIn: sql<number>`coalesce(sum(${assistUsage.tokensIn}), 0)::int`,
        tokensOut: sql<number>`coalesce(sum(${assistUsage.tokensOut}), 0)::int`,
      })
      .from(assistUsage)
      .where(gte(assistUsage.at, weekAgo));
    // Today's requests against the cap of all readers, counted by the
    // ledger's query that the reservation checks: cap > 0 and used >= cap
    // is exactly when the assistant is paused. Counted at 0 (no cap) too.
    const globalUsedToday = await this.ledger.spentToday();
    const withStatus = (status: string) =>
      statuses.find((row) => row.status === status)?.value ?? 0;
    return {
      books: {
        published: withStatus("published"),
        draft: withStatus("draft"),
        archived: withStatus("archived"),
      },
      readers: {
        total: readers?.total ?? 0,
        active7d: readers?.active7d ?? 0,
      },
      grants: { inForce: inForce?.value ?? 0 },
      exercisesSolved7d: solved?.value ?? 0,
      activity: days.map((day) => ({
        day,
        readers: active.find((row) => row.day === day)?.readers ?? 0,
      })),
      assist: {
        enabled: this.assist.enabled,
        dailyLimit: this.assist.dailyLimit,
        globalDailyLimit: this.assist.globalDailyLimit,
        globalUsedToday,
        requests7d: assist?.requests ?? 0,
        cached7d: assist?.cached ?? 0,
        failed7d: assist?.failed ?? 0,
        tokensIn7d: assist?.tokensIn ?? 0,
        tokensOut7d: assist?.tokensOut ?? 0,
      },
    };
  }

  async books(): Promise<{ items: AdminBook[] }> {
    const rows = await this.bookRows();
    return { items: rows.map((row) => this.bookItem(row)) };
  }

  async book(slug: string): Promise<AdminBookDetail> {
    if (!bookSlugSchema.safeParse(slug).success)
      throw new AppError("NOT_FOUND");
    const [row] = await this.bookRows(eq(books.slug, slug));
    if (!row) throw new AppError("NOT_FOUND");
    const outline = await this.database.db
      .select({
        n: chapters.n,
        short: chapters.short,
        title: chapters.title,
        exercises: sql<number>`cardinality(${chapters.exerciseIds})`,
        cards: sql<number>`cardinality(${chapters.cardIds})`,
        reached: sql<number>`(select count(*) from ${readerProgress}
          where ${q(readerProgress.bookId)} = ${q(chapters.bookId)}
            and ${q(readerProgress.lastChapter)} >= ${q(chapters.n)})::int`,
      })
      .from(chapters)
      .where(eq(chapters.bookId, row.id))
      .orderBy(asc(chapters.n));
    return { book: this.bookItem(row), chapters: outline };
  }

  private bookRows(where?: SQL) {
    return this.database.db
      .select({
        id: books.id,
        slug: books.slug,
        title: books.title,
        status: books.status,
        rule: books.rule,
        contentVersion: books.contentVersion,
        contentHash: books.contentHash,
        stats: sql<BookStats>`${books.meta}->'stats'`,
        readers: sql<number>`(select count(*) from ${readerProgress}
          where ${q(readerProgress.bookId)} = ${q(books.id)})::int`,
        importedAt: books.importedAt,
        publishedAt: books.publishedAt,
        updatedAt: books.updatedAt,
        version: books.version,
      })
      .from(books)
      .where(where)
      .orderBy(asc(books.createdAt), asc(books.slug));
  }

  private bookItem(
    row: Awaited<ReturnType<AdminService["bookRows"]>>[number],
  ): AdminBook {
    return {
      slug: row.slug,
      title: row.title,
      status: row.status,
      rule: row.rule,
      contentVersion: row.contentVersion,
      contentHash: row.contentHash,
      stats: row.stats,
      readers: row.readers,
      importedAt: row.importedAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  }

  async readers(query: z.infer<typeof adminReadersQuerySchema>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.readerRows(
      and(
        query.book ? eq(books.slug, query.book) : undefined,
        query.userId ? eq(readerProgress.userId, query.userId) : undefined,
        cursor
          ? or(
              lt(readerProgress.lastActiveAt, cursor.at),
              and(
                eq(readerProgress.lastActiveAt, cursor.at),
                lt(readerProgress.id, cursor.id),
              ),
            )
          : undefined,
      ),
    ).limit(query.limit + 1);
    const features = await this.featuresOf(rows.map((row) => row.userId));
    return toPage(
      rows,
      query.limit,
      (row) => this.readerItem(row, features),
      (row) => ({ at: row.lastActiveAt, id: row.id }),
    );
  }

  /** Every edu grant of the user and the user's progress in each book. */
  async reader(userId: string): Promise<AdminUserEducation> {
    if (!z.uuid().safeParse(userId).success) throw new AppError("NOT_FOUND");
    const now = this.clock.now();
    const owned = await this.database.db
      .select()
      .from(grants)
      .where(eq(grants.userId, userId))
      .orderBy(asc(grants.validFrom), asc(grants.grantId));
    const rows = await this.readerRows(eq(readerProgress.userId, userId));
    if (owned.length === 0 && rows.length === 0)
      throw new AppError("NOT_FOUND");
    const features = new Map([
      [
        userId,
        new Set(
          owned
            .filter((grant) => grantInForce(grant, now))
            .map((grant) => grant.feature),
        ),
      ],
    ]);
    return {
      userId,
      grants: owned.map((grant) => ({
        grantId: grant.grantId,
        feature: grant.feature,
        sourceType: grant.sourceType,
        state: grant.state,
        validFrom: grant.validFrom.toISOString(),
        validUntil: grant.validUntil?.toISOString() ?? null,
        inForce: grantInForce(grant, now),
      })),
      books: rows.map((row) => this.readerItem(row, features)),
    };
  }

  /** Readers' rows with their counts, newest activity first. */
  private readerRows(where: SQL | undefined) {
    return this.database.db
      .select({
        id: readerProgress.id,
        userId: readerProgress.userId,
        slug: books.slug,
        status: books.status,
        rule: books.rule,
        lastChapter: readerProgress.lastChapter,
        startedAt: readerProgress.startedAt,
        lastActiveAt: readerProgress.lastActiveAt,
        exercisesSolved: solvedExercises(
          readerProgress.userId,
          readerProgress.bookId,
        ),
        exercisesTotal: exerciseTotal(readerProgress.bookId),
        cardsKnown: knownCards(readerProgress.userId, readerProgress.bookId),
        cardsTotal: cardTotal(readerProgress.bookId),
      })
      .from(readerProgress)
      .innerJoin(books, eq(books.id, readerProgress.bookId))
      .where(where)
      .orderBy(desc(readerProgress.lastActiveAt), desc(readerProgress.id))
      .$dynamic();
  }

  private readerItem(
    row: Awaited<ReturnType<AdminService["readerRows"]>>[number],
    features: ReadonlyMap<string, ReadonlySet<string>>,
  ): AdminReader {
    return {
      userId: row.userId,
      book: row.slug,
      exercisesSolved: row.exercisesSolved,
      exercisesTotal: row.exercisesTotal,
      cardsKnown: row.cardsKnown,
      cardsTotal: row.cardsTotal,
      lastChapter: row.lastChapter,
      access: new BookPolicy(row.status, row.rule).readerAccess(
        features.get(row.userId) ?? new Set(),
      ),
      startedAt: row.startedAt.toISOString(),
      lastActiveAt: row.lastActiveAt.toISOString(),
    };
  }

  /** Features of the edu grants in force, per user. */
  private async featuresOf(
    userIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const features = new Map<string, Set<string>>();
    if (userIds.length === 0) return features;
    const now = this.clock.now();
    const rows = await this.database.db
      .select({
        userId: grants.userId,
        feature: grants.feature,
        state: grants.state,
        validFrom: grants.validFrom,
        validUntil: grants.validUntil,
      })
      .from(grants)
      .where(inArray(grants.userId, [...new Set(userIds)]));
    for (const row of rows) {
      if (!grantInForce(row, now)) continue;
      const set = features.get(row.userId) ?? new Set<string>();
      set.add(row.feature);
      features.set(row.userId, set);
    }
    return features;
  }

  async audit(query: z.infer<typeof adminAuditQuerySchema>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.database.db
      .select()
      .from(adminAudit)
      .where(
        and(
          query.targetId
            ? and(
                eq(adminAudit.targetType, "book"),
                eq(adminAudit.targetId, query.targetId),
              )
            : undefined,
          cursor
            ? or(
                lt(adminAudit.at, cursor.at),
                and(eq(adminAudit.at, cursor.at), lt(adminAudit.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(adminAudit.at), desc(adminAudit.id))
      .limit(query.limit + 1);
    return toPage(
      rows,
      query.limit,
      (entry): AdminAuditEntry => ({
        id: entry.id,
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason,
        data: entry.data,
        at: entry.at.toISOString(),
      }),
      (entry) => ({ at: entry.at, id: entry.id }),
    );
  }

  // Commands: each change and its audit row commit together.

  setStatus(
    actor: Actor,
    slug: string,
    input: SetBookStatus,
  ): Promise<BookCommandResult> {
    return this.change(actor, slug, input, async (book, _tx, now) =>
      this.commands.setStatus(book, input.status, now),
    );
  }

  setAccess(
    actor: Actor,
    slug: string,
    input: SetBookAccess,
  ): Promise<BookCommandResult> {
    return this.change(actor, slug, input, async (book, tx) => {
      const [chapterCount] = await tx
        .select({ value: count() })
        .from(chapters)
        .where(eq(chapters.bookId, book.id));
      return this.commands.setAccess(
        book,
        input.rule,
        chapterCount?.value ?? 0,
      );
    });
  }

  /**
   * Locks the book, checks `expectedVersion` (409 with the current version),
   * lets `decide` refuse (422) or describe the change, then writes the change,
   * the next version and the audit row in one transaction.
   */
  private async change(
    actor: Actor,
    slug: string,
    input: { expectedVersion: number; reason: string },
    decide: (book: LockedBook, tx: EduTx, now: Date) => Promise<BookChange>,
  ): Promise<BookCommandResult> {
    if (!bookSlugSchema.safeParse(slug).success)
      throw new AppError("NOT_FOUND");
    return this.database.db.transaction(async (tx) => {
      const now = this.clock.now();
      const [book] = await tx
        .select({
          id: books.id,
          slug: books.slug,
          status: books.status,
          rule: books.rule,
          version: books.version,
        })
        .from(books)
        .where(eq(books.slug, slug))
        .for("update");
      if (!book) throw new AppError("NOT_FOUND");
      if (book.version !== input.expectedVersion)
        throw new AppError("VERSION_CONFLICT", {
          fieldErrors: { version: [String(book.version)] },
        });
      let change: BookChange;
      try {
        change = await decide(book, tx, now);
      } catch (error) {
        if (error instanceof CommandRefused)
          throw new AppError("UNPROCESSABLE", {
            fieldErrors: { [error.field]: [error.reason] },
          });
        throw error;
      }
      const [after] = await tx
        .update(books)
        .set({ ...change.set, version: book.version + 1, updatedAt: now })
        .where(eq(books.id, book.id))
        .returning({
          slug: books.slug,
          status: books.status,
          rule: books.rule,
          version: books.version,
        });
      if (!after) throw new AppError("NOT_FOUND");
      await tx.insert(adminAudit).values({
        actorId: actor.userId,
        action: change.action,
        targetType: "book",
        targetId: book.slug,
        reason: input.reason,
        data: change.data,
        at: now,
      });
      return after;
    });
  }
}
