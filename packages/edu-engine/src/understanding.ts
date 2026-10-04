/*
 * "Explain it in your own words": the assistant grades a reader's retelling
 * of a chapter from 1 to 10, and edu-backend keeps the best grade per
 * chapter. A best grade of 7 or more counts as the chapter understood, the
 * rule of the original book pages; below that the reader is told what to
 * reread, and the chapter is not marked.
 */

/** The lowest score on the 1–10 scale. */
export const UNDERSTANDING_MIN = 1;
/** The highest score on the 1–10 scale. */
export const UNDERSTANDING_MAX = 10;
/** A best score from this one up confirms the chapter is understood. */
export const UNDERSTOOD_FROM = 7;

/** A score on the scale: whole, 1–10; anything else is no score. */
export function isUnderstandingScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= UNDERSTANDING_MIN &&
    value <= UNDERSTANDING_MAX
  );
}

/** Whether the chapter's best score confirms it is understood. */
export function isUnderstood(best: number | null | undefined): boolean {
  return isUnderstandingScore(best) && best >= UNDERSTOOD_FROM;
}

/**
 * The best score after a new one: the higher of the two, as edu-backend
 * keeps it. A score off the scale changes nothing.
 */
export function bestScore(
  previous: number | null | undefined,
  score: number | null | undefined,
): number | null {
  const kept = isUnderstandingScore(previous) ? previous : null;
  if (!isUnderstandingScore(score)) return kept;
  return kept === null ? score : Math.max(kept, score);
}
