import { AppError } from "@outegro/nest-common";

/**
 * A wallet's history pages by its operation counter (`wallet_version`,
 * strictly increasing per wallet), so operations made in the same
 * millisecond keep their order. The cursor is the last version shown.
 */
export const encodeVersionCursor = (version: number) =>
  Buffer.from(`v${version}`).toString("base64url");

export function decodeVersionCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return null;
  const text = Buffer.from(cursor, "base64url").toString();
  const version = /^v([1-9]\d{0,9})$/.exec(text)?.[1];
  if (!version)
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: { cursor: ["invalid"] },
    });
  return Number(version);
}
