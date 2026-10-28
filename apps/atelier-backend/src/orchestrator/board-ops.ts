import type {
  ApplicationFlag,
  ApplicationStage,
  ArchiveReason,
} from "@outegro/contracts/atelier";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "../common/database.js";
import { applications, history } from "../db/schema.js";

export type HistorySource = "system" | "mail" | "manual";

/** Appends to the application's history (never updated or deleted). */
export async function addHistory(
  tx: Executor,
  applicationId: string,
  entry: {
    at: Date;
    action: string;
    source?: HistorySource;
    details?: string | null;
  },
) {
  await tx.insert(history).values({
    applicationId,
    at: entry.at,
    action: entry.action,
    source: entry.source ?? "system",
    details: entry.details?.slice(0, 4000) ?? null,
  });
}

export async function addFlag(
  tx: Executor,
  applicationId: string,
  flag: ApplicationFlag,
  now: Date,
) {
  await tx
    .update(applications)
    .set({
      flags: sql`(select array_agg(distinct f) from unnest(array_append(${applications.flags}, ${flag}::text)) f)`,
      updatedAt: now,
    })
    .where(eq(applications.id, applicationId));
}

export async function removeFlags(
  tx: Executor,
  applicationId: string,
  flags: ApplicationFlag[],
  now: Date,
) {
  if (!flags.length) return;
  await tx
    .update(applications)
    .set({
      flags: sql`coalesce((select array_agg(f) from unnest(${applications.flags}) f where f not in (${sql.join(
        flags.map((flag) => sql`${flag}`),
        sql`, `,
      )})), '{}'::text[])`,
      updatedAt: now,
    })
    .where(eq(applications.id, applicationId));
}

/** Moves a card; archived needs its reason, any other column clears it. */
export async function setStage(
  tx: Executor,
  applicationId: string,
  stage: ApplicationStage,
  now: Date,
  archiveReason: ArchiveReason | null = null,
) {
  await tx
    .update(applications)
    .set({
      stage,
      archiveReason:
        stage === "archived" ? (archiveReason ?? "withdrawn") : null,
      updatedAt: now,
    })
    .where(eq(applications.id, applicationId));
}
