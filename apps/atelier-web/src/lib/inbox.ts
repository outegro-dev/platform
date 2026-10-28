/** J/K in a list of `length`: one step, stopping at both ends. */
export function nextIndex(index: number, length: number, step: 1 | -1): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + step));
}
