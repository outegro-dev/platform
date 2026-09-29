import { AppError } from "@outegro/nest-common";
import { z } from "zod";

/** Opaque keyset cursor: a timestamp and a uuid tie-breaker. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  // The id goes into a uuid comparison and the date into a timestamptz one;
  // anything PostgreSQL cannot read would be a 500. Cursors this service
  // writes are ISO strings of years 1 to 9999 (encodeCursor).
  const year = date.getUTCFullYear();
  if (
    !id ||
    !z.uuid().safeParse(id).success ||
    Number.isNaN(date.getTime()) ||
    year < 1 ||
    year > 9999
  )
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: { cursor: ["invalid_cursor"] },
    });
  return { at: date, id };
}

/** Page of `limit` items from `limit + 1` rows, with the cursor of the last one. */
export function toPage<Row, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
  key: (row: Row) => { at: Date; id: string },
): { items: Item[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const next = rows.length > limit && last ? key(last) : null;
  return {
    items: page.map(map),
    nextCursor: next ? encodeCursor(next.at, next.id) : null,
  };
}
