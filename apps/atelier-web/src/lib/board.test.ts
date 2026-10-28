import { type Board, boardSchema } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import {
  applyMove,
  columnsOf,
  filtersQuery,
  findCard,
  matches,
  parseFilters,
  replyRate,
  sourcesOf,
} from "./board";
import { mockBackend, resetMock } from "./mock";

function board(): Board {
  resetMock(Date.parse("2026-10-28T09:00:00.000Z"));
  return boardSchema.parse(mockBackend("GET", "/board").body);
}

describe("board filters", () => {
  it("read only known values from the address bar", () => {
    expect(
      parseFilters(
        new URLSearchParams("q=Northwind&source=lever&flag=meeting"),
      ),
    ).toEqual({ q: "Northwind", source: "lever", flag: "meeting" });
    expect(parseFilters(new URLSearchParams("flag=urgent")).flag).toBe("");
  });

  it("write back only what is set", () => {
    expect(filtersQuery({ q: "  ", source: "", flag: "" })).toBe("");
    expect(filtersQuery({ q: "node", source: "ashby", flag: "" })).toBe(
      "?q=node&source=ashby",
    );
  });

  it("match every word in company, role or location, ignoring case and accents", () => {
    const card = board().columns.find((c) => c.stage === "fit")?.items[0];
    if (!card) throw new Error("no fit card");
    const words = `${card.company.toUpperCase()} ${card.role.split(" ")[0]}`;
    expect(matches(card, { q: words, source: "", flag: "" })).toBe(true);
    expect(matches(card, { q: "zzzz", source: "", flag: "" })).toBe(false);
    expect(
      matches(
        { ...card, company: "Café Société" },
        { q: "cafe societe", source: "", flag: "" },
      ),
    ).toBe(true);
  });

  it("filter by source and by flag", () => {
    const all = columnsOf(board()).flatMap((c) => c.items);
    const lever = all.filter((c) =>
      matches(c, { q: "", source: "lever", flag: "" }),
    );
    expect(lever.length).toBeGreaterThan(0);
    expect(lever.every((c) => c.source === "lever")).toBe(true);
    const meetings = all.filter((c) =>
      matches(c, { q: "", source: "", flag: "meeting" }),
    );
    expect(meetings.length).toBeGreaterThan(0);
    expect(meetings.every((c) => c.flags.includes("meeting"))).toBe(true);
  });
});

describe("board columns", () => {
  it("have every stage once, in the order of the funnel", () => {
    const stages = columnsOf({ ...board(), columns: [] }).map((c) => c.stage);
    expect(stages[0]).toBe("found");
    expect(stages.at(-1)).toBe("archived");
    expect(new Set(stages).size).toBe(11);
  });

  it("list sources with the most cards first", () => {
    const sources = sourcesOf(board());
    expect(sources.length).toBeGreaterThan(3);
    expect(new Set(sources).size).toBe(sources.length);
  });
});

describe("an optimistic move", () => {
  it("puts the card on top of its new column", () => {
    const before = board();
    const card = before.columns.find((c) => c.stage === "fit")?.items[0];
    if (!card) throw new Error("no fit card");
    const after = applyMove(before, { id: card.id, stage: "ready" });
    expect(after.columns.find((c) => c.stage === "ready")?.items[0]?.id).toBe(
      card.id,
    );
    expect(
      after.columns
        .find((c) => c.stage === "fit")
        ?.items.some((c) => c.id === card.id),
    ).toBe(false);
    expect(findCard(after, card.id)?.stage).toBe("ready");
  });

  it("keeps the reason only in the archive", () => {
    const before = board();
    const card = before.columns.find((c) => c.stage === "sent")?.items[0];
    if (!card) throw new Error("no sent card");
    const archived = applyMove(before, {
      id: card.id,
      stage: "archived",
      archiveReason: "ghosted",
    });
    expect(findCard(archived, card.id)?.archiveReason).toBe("ghosted");
    const back = applyMove(archived, { id: card.id, stage: "sent" });
    expect(findCard(back, card.id)?.archiveReason).toBeNull();
  });

  it("changes nothing for an unknown card", () => {
    const before = board();
    expect(applyMove(before, { id: "nope", stage: "offer" })).toBe(before);
  });
});

describe("reply rate", () => {
  it("is null before anything is sent and never above 1", () => {
    const stats = board().stats;
    expect(replyRate({ ...stats, sent: 0 })).toBeNull();
    expect(replyRate({ ...stats, sent: 2, replies: 5 })).toBe(1);
    expect(replyRate({ ...stats, sent: 4, replies: 1 })).toBe(0.25);
  });
});
