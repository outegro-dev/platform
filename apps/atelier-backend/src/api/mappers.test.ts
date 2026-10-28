import {
  applicationCardSchema,
  applicationDetailSchema,
  boardSchema,
  pipelineStepViewSchema,
} from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { testAnalysis, testFields } from "../test/fixtures.js";
import {
  type CardRow,
  toBoard,
  toCard,
  toFit,
  toStepViews,
} from "./mappers.js";

const now = new Date("2026-10-28T12:00:00.000Z");

const row = (patch: Partial<CardRow> = {}): CardRow => ({
  id: crypto.randomUUID(),
  stage: "ready",
  archiveReason: null,
  flags: [],
  score: 72.4,
  channel: null,
  sentAt: null,
  updatedAt: now,
  fields: testFields(),
  analysis: testAnalysis,
  ...patch,
});

describe("board mappers", () => {
  it("maps a card to the contract", () => {
    const card = toCard(
      row({ flags: ["cv_opened", "cv_opened"], archiveReason: "rejected" }),
    );
    expect(applicationCardSchema.parse(card)).toEqual(card);
    expect(card).toMatchObject({
      company: "Examplecorp",
      role: "Senior Backend Engineer",
      score: 72,
      source: "lever",
      flags: ["cv_opened"],
      // Only archived cards carry a reason.
      archiveReason: null,
    });
  });

  it("builds every column and the stats", () => {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const board = toBoard(
      [
        row({ stage: "found", score: null, analysis: null }),
        row({ stage: "sent", sentAt: now }),
        row({ stage: "hr", sentAt: yesterday }),
        row({ stage: "tech", sentAt: yesterday }),
        row({ stage: "offer", sentAt: yesterday }),
        row({
          stage: "archived",
          archiveReason: "rejected",
          sentAt: yesterday,
        }),
        row({ stage: "archived", archiveReason: "skipped" }),
      ],
      now,
    );
    expect(boardSchema.parse(board)).toEqual(board);
    expect(board.columns.map((column) => column.stage)).toEqual([
      "found",
      "fit",
      "building",
      "ready",
      "sent",
      "hr",
      "task",
      "tech",
      "final",
      "offer",
      "archived",
    ]);
    expect(board.stats).toEqual({
      total: 7,
      sent: 5,
      sentToday: 1,
      replies: 4,
      interviews: 3,
      offers: 1,
    });
  });

  it("labels requirement coverage and shows the pipeline strip", () => {
    const fit = toFit(
      testAnalysis,
      {
        utility: 64,
        coverage: [
          { requirementId: "R1", best: 1, caseIds: ["A1"] },
          { requirementId: "R2", best: 0.5, caseIds: ["A2"] },
        ],
      },
      null,
    );
    expect(fit?.score).toBe(64);
    expect(fit?.requirements.map((item) => item.label)).toEqual([
      "direct",
      "related",
    ]);
    const steps = toStepViews([
      {
        step: "match",
        status: "done",
        attempt: 1,
        usage: { llmCalls: 1 },
        note: null,
        error: null,
        startedAt: new Date(now.getTime() - 1500),
        finishedAt: now,
      },
      {
        step: "compose",
        status: "paused",
        attempt: 2,
        usage: null,
        note: "quota: paused until 2026-10-28T13:00:00.000Z",
        error: null,
        startedAt: now,
        finishedAt: null,
      },
      // Not a task type (tick steps): left out of the strip.
      {
        step: "follow-up",
        status: "done",
        attempt: 1,
        usage: null,
        note: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
    ]);
    for (const step of steps) pipelineStepViewSchema.parse(step);
    expect(steps).toEqual([
      { step: "match", status: "ok", ms: 1500, llmCalls: 1, note: null },
      {
        step: "compose",
        status: "waiting",
        ms: null,
        llmCalls: 0,
        note: "quota: paused until 2026-10-28T13:00:00.000Z",
      },
    ]);
    const detail = {
      card: toCard(row()),
      vacancy: {
        title: "Senior Backend Engineer",
        company: "Examplecorp",
        location: null,
        url: "https://jobs.lever.co/examplecorp/1234",
        applyUrl: null,
        salary: null,
        text: "…",
      },
      fit,
      cv: null,
      materials: [],
      answers: [],
      contacts: [],
      history: [],
      pipeline: steps,
    };
    expect(applicationDetailSchema.parse(detail)).toEqual(detail);
  });
});
