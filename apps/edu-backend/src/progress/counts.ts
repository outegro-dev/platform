import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { qualified as q } from "../common/sql.js";
import { cardStatesTable, chapters, exerciseResults } from "../db/schema.js";

/*
 * Progress counts of one reader in one book, as correlated subqueries for
 * lists: `userId` and `bookId` are a value or a column of the outer query.
 * Only exercises and cards the book still has count: an import may drop or
 * reword some, and their old results stay stored but no longer count.
 */

type Ref = AnyPgColumn | string;
const ref = (value: Ref) =>
  typeof value === "string" ? sql`${value}` : q(value);

export const solvedExercises = (userId: Ref, bookId: Ref): SQL<number> =>
  sql<number>`(select count(*) from ${exerciseResults}
    where ${q(exerciseResults.userId)} = ${ref(userId)}
      and ${q(exerciseResults.bookId)} = ${ref(bookId)}
      and ${q(exerciseResults.solved)}
      and exists (select 1 from ${chapters}
                   where ${q(chapters.bookId)} = ${q(exerciseResults.bookId)}
                     and ${q(exerciseResults.exerciseId)} = any(${q(chapters.exerciseIds)})))::int`;

export const knownCards = (userId: Ref, bookId: Ref): SQL<number> =>
  sql<number>`(select count(*) from ${cardStatesTable}
    where ${q(cardStatesTable.userId)} = ${ref(userId)}
      and ${q(cardStatesTable.bookId)} = ${ref(bookId)}
      and ${q(cardStatesTable.state)} = 'know'
      and exists (select 1 from ${chapters}
                   where ${q(chapters.bookId)} = ${q(cardStatesTable.bookId)}
                     and ${q(cardStatesTable.cardId)} = any(${q(chapters.cardIds)})))::int`;

/** Exercises and cards of a book now. */
export const exerciseTotal = (bookId: Ref): SQL<number> =>
  sql<number>`(select coalesce(sum(cardinality(${q(chapters.exerciseIds)})), 0)
    from ${chapters} where ${q(chapters.bookId)} = ${ref(bookId)})::int`;

export const cardTotal = (bookId: Ref): SQL<number> =>
  sql<number>`(select coalesce(sum(cardinality(${q(chapters.cardIds)})), 0)
    from ${chapters} where ${q(chapters.bookId)} = ${ref(bookId)})::int`;
