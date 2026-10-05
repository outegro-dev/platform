import { getTableName, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * `"table"."column"`, for correlated subqueries in selected fields: in a
 * select from a single table, Drizzle writes the columns placed directly in
 * a selected sql`` template without their table, and inside a subquery such
 * a bare name binds to the subquery's own table.
 */
export function qualified(column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
