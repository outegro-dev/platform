import type { pipelineStepViewSchema } from "@outegro/contracts/atelier";
import {
  type ApplicationCard,
  type ApplicationDetail,
  type ApplicationStage,
  applicationStages,
  atelierTaskTypeSchema,
  type Board,
  type VacancyAnalysis,
  type VacancyFields,
} from "@outegro/contracts/atelier";
import type { z } from "zod";

/** The columns a card needs, from an application joined with its vacancy. */
export type CardRow = {
  id: string;
  stage: ApplicationStage;
  archiveReason: ApplicationCard["archiveReason"];
  flags: ApplicationCard["flags"];
  score: number | null;
  channel: ApplicationCard["channel"];
  sentAt: Date | null;
  updatedAt: Date;
  fields: VacancyFields;
  analysis: VacancyAnalysis | null;
};

export function toCard(row: CardRow): ApplicationCard {
  return {
    id: row.id,
    company: row.analysis?.company ?? row.fields.company,
    role: row.analysis?.title ?? row.fields.title,
    stage: row.stage,
    archiveReason: row.stage === "archived" ? row.archiveReason : null,
    flags: [...new Set(row.flags)],
    score:
      row.score === null
        ? null
        : Math.max(0, Math.min(100, Math.round(row.score))),
    channel: row.channel,
    source: row.fields.provider,
    location: row.fields.location,
    sentAt: row.sentAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const replied = new Set<ApplicationStage>([
  "hr",
  "task",
  "tech",
  "final",
  "offer",
]);
const interviewing = new Set<ApplicationStage>(["hr", "tech", "final"]);

/** Columns left to right, newest first in each; stats over every card. */
export function toBoard(rows: CardRow[], now: Date): Board {
  const startOfDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const cards = rows
    .map(toCard)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sent = rows.filter((row) => row.sentAt !== null);
  return {
    columns: applicationStages.map((stage) => ({
      stage,
      items: cards.filter((card) => card.stage === stage),
    })),
    stats: {
      total: rows.length,
      sent: sent.length,
      sentToday: sent.filter(
        (row) => (row.sentAt as Date).getTime() >= startOfDay,
      ).length,
      replies: sent.filter(
        (row) =>
          replied.has(row.stage) ||
          (row.stage === "archived" &&
            (row.archiveReason === "rejected" ||
              row.archiveReason === "hired")),
      ).length,
      interviews: rows.filter(
        (row) =>
          interviewing.has(row.stage) ||
          row.stage === "offer" ||
          (row.stage === "archived" && row.archiveReason === "hired"),
      ).length,
      offers: rows.filter(
        (row) =>
          row.stage === "offer" ||
          (row.stage === "archived" && row.archiveReason === "hired"),
      ).length,
    },
  };
}

type StepView = z.infer<typeof pipelineStepViewSchema>;

export type StepRow = {
  step: string;
  status: string;
  attempt: number;
  usage: { llmCalls: number } | null;
  note: string | null;
  error: { message: string } | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const viewStatus: Record<string, StepView["status"]> = {
  queued: "waiting",
  paused: "waiting",
  running: "running",
  done: "ok",
  skipped: "skipped",
  failed: "failed",
  waiting_human: "needs_human",
};

/** A job's steps as the card's pipeline strip shows them. */
export function toStepViews(rows: StepRow[]): StepView[] {
  return rows.flatMap((row) => {
    const step = atelierTaskTypeSchema.safeParse(row.step);
    if (!step.success) return [];
    return [
      {
        step: step.data,
        status: viewStatus[row.status] ?? "waiting",
        ms:
          row.startedAt && row.finishedAt
            ? Math.max(0, row.finishedAt.getTime() - row.startedAt.getTime())
            : null,
        llmCalls: row.usage?.llmCalls ?? 0,
        note: (row.error?.message ?? row.note)?.slice(0, 500) ?? null,
      },
    ];
  });
}

type Fit = NonNullable<ApplicationDetail["fit"]>;

/** How well the selected cases cover each requirement of the analysis. */
export function toFit(
  analysis: VacancyAnalysis | null,
  selection: {
    utility?: number;
    coverage?: { requirementId: string; best: number; caseIds: string[] }[];
  } | null,
  score: number | null,
): Fit | null {
  if (!analysis || !selection) return null;
  const coverage = new Map(
    (selection.coverage ?? []).map((item) => [item.requirementId, item]),
  );
  return {
    score: Math.max(
      0,
      Math.min(100, Math.round(score ?? selection.utility ?? 0)),
    ),
    requirements: analysis.requirements.map((requirement) => {
      const item = coverage.get(requirement.id);
      const best = item?.best ?? 0;
      return {
        id: requirement.id,
        text: requirement.text,
        importance: requirement.importance,
        label:
          best >= 1
            ? "direct"
            : best >= 0.5
              ? "related"
              : best > 0
                ? "weak"
                : "missing",
        caseIds: best > 0 ? (item?.caseIds ?? []) : [],
      };
    }),
  };
}
