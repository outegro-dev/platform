import { isUnderstandingScore } from "@outegro/edu-engine";

/**
 * The score line: «Оценка понимания» in any letter case, then any mix of
 * spaces, bold or italic marks, a colon or a dash, then the number —
 * «**Оценка понимания:** 8», «**Оценка понимания: 8**», «**Оценка
 * понимания**: 8», «Оценка понимания: **8**», «оценка понимания — 8 из 10»,
 * «Оценка понимания: 8/10». A number that goes on (more digits, a decimal
 * part) is not a score.
 */
const SCORE = /оценка понимания[\s*_:–—-]*(\d+)(?!\d|[.,]\d)/giu;

/**
 * The 1–10 score that closes an understanding check: the last score line
 * of the answer wins. Null when there is none (the answer was cut off, or
 * the model ignored the format) and when the last one is off the scale
 * (0, 75): a wrong number is no score, not the nearest one.
 */
export function understandingScore(answer: string): number | null {
  const last = [...answer.matchAll(SCORE)].at(-1);
  if (!last) return null;
  const value = Number(last[1]);
  return isUnderstandingScore(value) ? value : null;
}
