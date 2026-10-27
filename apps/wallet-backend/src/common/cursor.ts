import { AppError } from "@outegro/nest-common";
import { type AnyColumn, and, eq, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";

export type Cursor = { at: Date; id: string };

/** Opaque cursor over (timestamp desc, id desc). */
export const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");

export function decodeCursor(cursor: string): Cursor {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  // The id goes into a uuid comparison; anything else would be a 500.
  if (!id || !z.uuid().safeParse(id).success || Number.isNaN(date.getTime()))
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: { cursor: ["invalid"] },
    });
  return { at: date, id };
}

/** Rows strictly after the cursor in (at desc, id desc) order. */
export function after(
  cursor: Cursor | null,
  atColumn: AnyColumn,
  idColumn: AnyColumn,
): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(atColumn, cursor.at),
    and(eq(atColumn, cursor.at), lt(idColumn, cursor.id)),
  );
}

/** Cuts the extra row fetched to learn whether another page exists. */
export function page<T>(
  rows: T[],
  limit: number,
  key: (row: T) => { at: Date; id: string },
) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(key(last).at, key(last).id)
        : null,
  };
}

export const pageQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
