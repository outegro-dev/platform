import {
  applicationDetailSchema,
  applicationStages,
  boardSchema,
  inboxSchema,
  pipelineOverviewSchema,
} from "@outegro/contracts/atelier";
import { beforeEach, describe, expect, it } from "vitest";
import { mockBackend, resetMock } from "./mock";
import { mockCvPdf } from "./mock-pdf";
import {
  addVacancyResponseSchema,
  cardResponseSchema,
  jobAcceptedSchema,
  profileSummarySchema,
  providerResponseSchema,
} from "./schemas";

/*
 * The fake backend answers inside the contract, so the interface built on
 * it works against atelier-backend unchanged.
 */

const get = (path: string) => {
  const answer = mockBackend("GET", path);
  expect(answer.status, path).toBe(200);
  return answer.body;
};

const board = () => boardSchema.parse(get("/board"));
const cardIn = (stage: string) => {
  const card = board().columns.find((c) => c.stage === stage)?.items[0];
  if (!card) throw new Error(`no card in ${stage}`);
  return card;
};

beforeEach(() => {
  resetMock(Date.parse("2026-10-28T09:00:00.000Z"));
});

describe("mock atelier-backend reads", () => {
  it("answer every screen inside the contract", () => {
    const b = board();
    expect(b.columns.map((c) => c.stage)).toEqual([...applicationStages]);
    expect(b.stats.total).toBe(
      b.columns.reduce((sum, c) => sum + c.items.length, 0),
    );
    expect(inboxSchema.parse(get("/inbox")).matches.length).toBeGreaterThan(0);
    expect(
      pipelineOverviewSchema.parse(get("/pipeline")).providers.length,
    ).toBeGreaterThan(0);
    expect(profileSummarySchema.parse(get("/profile")).cases.length).toBe(18);
  });

  it("give every application a detail inside the contract", () => {
    for (const column of board().columns)
      for (const card of column.items) {
        const detail = applicationDetailSchema.parse(
          get(`/applications/${card.id}`),
        );
        expect(detail.card).toEqual(card);
      }
  });

  it("use made-up data only", () => {
    const text = JSON.stringify([get("/board"), get("/profile")]);
    expect(text).not.toMatch(/lukashik|outegro\.dev\/cv|@gmail/i);
  });

  it("answer 404 for an unknown application or path", () => {
    expect(
      mockBackend("GET", "/applications/00000000-0000-4000-8000-000000000000")
        .status,
    ).toBe(404);
    expect(mockBackend("GET", "/nothing").status).toBe(404);
  });
});

describe("mock atelier-backend writes", () => {
  it("moves a card and records it in the history", () => {
    const card = cardIn("fit");
    const answer = mockBackend("POST", `/applications/${card.id}/stage`, {
      stage: "building",
    });
    expect(cardResponseSchema.parse(answer.body).stage).toBe("building");
    const detail = applicationDetailSchema.parse(
      get(`/applications/${card.id}`),
    );
    expect(detail.history[0]).toMatchObject({
      action: "moved",
      source: "manual",
    });
  });

  it("refuses a move outside the contract", () => {
    const card = cardIn("fit");
    expect(
      mockBackend("POST", `/applications/${card.id}/stage`, {
        stage: "somewhere",
      }).status,
    ).toBe(422);
  });

  it("sends only a ready application", () => {
    const ready = cardIn("ready");
    const sent = mockBackend("POST", `/applications/${ready.id}/send`, {});
    expect(sent.status).toBe(202);
    jobAcceptedSchema.parse(sent.body);
    expect(
      applicationDetailSchema.parse(get(`/applications/${ready.id}`)).card
        .stage,
    ).toBe("sent");
    const found = cardIn("found");
    expect(
      mockBackend("POST", `/applications/${found.id}/send`, {}).status,
    ).toBe(409);
  });

  it("retries from the failed step and clears the flag", () => {
    const broken = board()
      .columns.flatMap((c) => c.items)
      .find((c) => c.flags.includes("needs_edit"));
    if (!broken) throw new Error("no broken card");
    const answer = mockBackend("POST", `/applications/${broken.id}/retry`, {});
    jobAcceptedSchema.parse(answer.body);
    const detail = applicationDetailSchema.parse(
      get(`/applications/${broken.id}`),
    );
    expect(detail.card.flags).not.toContain("needs_edit");
    expect(detail.pipeline.some((s) => s.status === "running")).toBe(true);
    expect(detail.pipeline.some((s) => s.status === "failed")).toBe(false);
  });

  it("skips a match into the archive", () => {
    const match = inboxSchema.parse(get("/inbox")).matches[0];
    if (!match) throw new Error("no match");
    const answer = mockBackend("POST", `/inbox/${match.id}/skip`, {});
    expect(cardResponseSchema.parse(answer.body)).toMatchObject({
      stage: "archived",
      archiveReason: "skipped",
    });
    expect(
      inboxSchema.parse(get("/inbox")).matches.some((m) => m.id === match.id),
    ).toBe(false);
  });

  it("lifts a provider pause", () => {
    const paused = pipelineOverviewSchema
      .parse(get("/pipeline"))
      .providers.find((p) => p.pausedUntil);
    if (!paused) throw new Error("no paused provider");
    const answer = mockBackend("DELETE", `/providers/${paused.id}/pause`);
    expect(providerResponseSchema.parse(answer.body)).toMatchObject({
      pausedUntil: null,
      available: true,
    });
  });

  it("adds a vacancy by link or text, and refuses neither", () => {
    const byUrl = mockBackend("POST", "/vacancies", {
      url: "https://jobs.lever.example/northwind/77",
    });
    expect(byUrl.status).toBe(201);
    const { applicationId } = addVacancyResponseSchema.parse(byUrl.body);
    expect(
      applicationDetailSchema.parse(get(`/applications/${applicationId}`)).card
        .stage,
    ).toBe("found");
    expect(mockBackend("POST", "/vacancies", {}).status).toBe(422);
    expect(
      mockBackend("POST", "/vacancies", { text: "too short" }).status,
    ).toBe(422);
  });
});

describe("the mock CV", () => {
  it("is a PDF with a valid cross-reference table", () => {
    const bytes = mockCvPdf({
      name: "Rowan Ellery",
      headline: "Senior Full-Stack Engineer",
      company: "Northwind Labs",
      role: "Senior Full-Stack Engineer (Node.js)",
    });
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const first = /0000000000 65535 f \n(\d{10})/.exec(text)?.[1];
    expect(text.slice(Number(first), Number(first) + 7)).toBe("1 0 obj");
  });
});
