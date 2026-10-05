import type { BookAccess, ChapterAccess } from "@outegro/contracts/edu";

/*
 * Which answers to "may this reader read?" open a whole book. A preview
 * opens only the first chapters of a paid book, so it is readable
 * (`readableAccess`, chapter by chapter) without opening everything.
 */

/** Access that opens every chapter: open to all, a grant, or staff. */
export const fullAccess = Object.freeze(["open", "granted", "staff"] as const);
export type FullAccess = (typeof fullAccess)[number];

/** Whether this access opens the whole book, not just its preview. */
export const isFullAccess = (
  access: BookAccess | ChapterAccess,
): access is FullAccess => (fullAccess as readonly string[]).includes(access);
