import { AppError } from "@outegro/nest-common";
import { z } from "zod";

/** Opaque keyset cursor over (createdAt desc, id desc). */
export const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");

export const decodeCursor = (cursor: string) => {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  if (!id || !z.uuid().safeParse(id).success || Number.isNaN(date.getTime()))
    throw new AppError("VALIDATION_FAILED");
  return { at: date, id };
};
