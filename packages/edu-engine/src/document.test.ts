import { type Chapter, chapterAccessSchema } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import { isReadable, readableAccess } from "./access.js";
import { cardsOf, exerciseIdsOf, walkBlocks } from "./document.js";

const quiz = (id: string) =>
  ({
    t: "quiz",
    id,
    q: [{ t: "p", c: ["Вопрос?"] }],
    options: [["A"], ["B"]],
    answer: [0],
    why: [],
  }) as const;

const chapter: Pick<Chapter, "blocks"> = {
  blocks: [
    { t: "h3", id: "n01-runtime", c: ["Runtime"] },
    {
      t: "explain",
      topic: "Тема",
      views: [{ kind: "analogy", body: [quiz("n01-q-0a1b2c3d")] }],
    },
    {
      t: "note",
      tone: "trap",
      title: "Ловушка",
      body: [{ t: "ul", items: [[quiz("n01-q-33333333")]] }],
    },
    quiz("n01-q-11111111"),
    {
      t: "details",
      summary: ["Ещё"],
      body: [
        {
          t: "cards",
          cards: [{ id: "n01-c-22222222", front: ["Q"], back: ["A"] }],
        },
      ],
    },
  ] as Chapter["blocks"],
};

describe("chapter document", () => {
  it("finds exercises and cards nested in other blocks, in reading order", () => {
    expect(exerciseIdsOf(chapter)).toEqual([
      "n01-q-0a1b2c3d",
      "n01-q-33333333",
      "n01-q-11111111",
    ]);
    expect(cardsOf(chapter).map((card) => card.id)).toEqual(["n01-c-22222222"]);
  });

  it("visits every block once, parents before children", () => {
    const seen: string[] = [];
    walkBlocks(chapter.blocks, (block) => {
      seen.push(block.t);
    });
    expect(seen).toEqual([
      "h3",
      "explain",
      "quiz",
      "p",
      "note",
      "ul",
      "quiz",
      "p",
      "quiz",
      "p",
      "details",
      "cards",
    ]);
  });
});

describe("chapter access", () => {
  it("opens a chapter only for the readable answers", () => {
    expect(chapterAccessSchema.options.filter(isReadable)).toEqual([
      ...readableAccess,
    ]);
    expect(isReadable("sign_in")).toBe(false);
    expect(isReadable("locked")).toBe(false);
  });
});
