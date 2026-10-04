/*
 * The reader's progress as the platform counts it. Exercise ids start with
 * their chapter's id (`n03-q-1a2b3c4d`), so a progress map that knows no
 * chapters can still be counted per chapter.
 */

type ExerciseOutcomes =
  | Readonly<Record<string, boolean>>
  | ReadonlyMap<string, boolean>
  | null
  | undefined;

/** A Map, or a map that is not one by prototype (MobX's observable map). */
const isMapLike = (
  value: NonNullable<ExerciseOutcomes>,
): value is ReadonlyMap<string, boolean> =>
  typeof (value as { get?: unknown }).get === "function" &&
  typeof (value as { entries?: unknown }).entries === "function";

/** Exercises solved in one chapter (`true` in the progress map). */
export function solvedIn(exercises: ExerciseOutcomes, chapterId: string) {
  if (!exercises) return 0;
  const prefix = `${chapterId}-`;
  const entries = isMapLike(exercises)
    ? exercises.entries()
    : Object.entries(exercises);
  let solved = 0;
  for (const [id, done] of entries)
    if (done === true && id.startsWith(prefix)) solved++;
  return solved;
}
