import type {
  VacancyFields,
  VacancyStructure,
} from "@outegro/contracts/atelier";
import { eq, or } from "drizzle-orm";
import type { Executor } from "../common/database.js";
import { vacancies } from "../db/schema.js";
import type { VacancyKeys } from "../orchestrator/outputs.js";

export type Vacancy = typeof vacancies.$inferSelect;

/**
 * An ATS posting beats an aggregator copy: the copy that knows the original
 * form (ats + applyUrl) is the one the catalog keeps.
 */
function better(next: VacancyFields, stored: VacancyFields) {
  const score = (fields: VacancyFields) =>
    (fields.ats && fields.ats !== "other" ? 2 : 0) +
    (fields.applyUrl ? 1 : 0) +
    (fields.originalUrl === null ? 1 : 0);
  return score(next) > score(stored);
}

/**
 * Publishes a vacancy to the shared catalog. Copies meet on any of the
 * three keys (URL, text hash, company + role + location); a copy that is
 * the original ATS posting replaces the stored fields of an aggregator copy.
 */
export async function publishVacancy(
  tx: Executor,
  input: {
    fields: VacancyFields;
    structure: VacancyStructure;
    keys: VacancyKeys;
    now: Date;
  },
): Promise<{ vacancy: Vacancy; duplicate: boolean }> {
  const { keys } = input;
  const [existing] = await tx
    .select()
    .from(vacancies)
    .where(
      or(
        eq(vacancies.urlKey, keys.urlKey),
        eq(vacancies.textKey, keys.textKey),
        eq(vacancies.roleKey, keys.roleKey),
      ),
    )
    .orderBy(vacancies.createdAt)
    .limit(1)
    .for("update");
  if (existing) {
    if (!better(input.fields, existing.fields))
      return { vacancy: existing, duplicate: true };
    // The other keys may belong to further copies; only this row's change.
    const [updated] = await tx
      .update(vacancies)
      .set({
        fields: input.fields,
        structure: input.structure,
        status: "open",
        updatedAt: input.now,
      })
      .where(eq(vacancies.id, existing.id))
      .returning();
    return { vacancy: updated ?? existing, duplicate: true };
  }
  const [created] = await tx
    .insert(vacancies)
    .values({
      urlKey: keys.urlKey,
      textKey: keys.textKey,
      roleKey: keys.roleKey,
      fields: input.fields,
      structure: input.structure,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return { vacancy: created, duplicate: false };
  // A concurrent insert of the same posting won: use that row.
  const [winner] = await tx
    .select()
    .from(vacancies)
    .where(
      or(
        eq(vacancies.urlKey, keys.urlKey),
        eq(vacancies.textKey, keys.textKey),
      ),
    )
    .limit(1);
  if (!winner) throw new Error("vacancy insert lost and no winner found");
  return { vacancy: winner, duplicate: true };
}
