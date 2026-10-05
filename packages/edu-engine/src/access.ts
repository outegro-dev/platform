import type { ChapterAccess } from "@outegro/contracts/edu";

/*
 * Which answers to "may this reader open the chapter?" let them read it.
 * edu-backend decides the access of each chapter; edu-web only shows it.
 */

/** Access values that open a chapter: the rest say why it is closed. */
export const readableAccess: readonly ChapterAccess[] = Object.freeze([
  "open",
  "preview",
  "granted",
  "staff",
]);

/** Whether a chapter with this access can be read. */
export const isReadable = (access: ChapterAccess): boolean =>
  readableAccess.includes(access);
