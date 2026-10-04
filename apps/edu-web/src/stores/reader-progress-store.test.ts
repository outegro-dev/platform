import { describe, expect, it, vi } from "vitest";
import type { CardInput, WriteOutcome } from "@/lib/reader-api";
import { cardSaveKey } from "./reader-progress-store";
import { emptyProgress, fakeApi, flush, testStores } from "./testing";

const card = "n01-c-00000001";

describe("ReaderProgressStore", () => {
  it("starts from the server's progress", () => {
    const { stores } = testStores({
      progress: {
        exercises: {
          "n01-q-00000001": true,
          "n01-o-00000002": false,
          "n02-q-00000003": true,
        },
        cards: { [card]: "know" },
        lastChapter: 2,
        explainView: "code",
        understanding: { "1": 7 },
      },
    });
    const { progress } = stores;
    expect(progress.isSolved("n01-q-00000001")).toBe(true);
    expect(progress.isSolved("n01-o-00000002")).toBe(false);
    expect(progress.solvedIn("n01")).toBe(1);
    expect(progress.solvedIn("n02")).toBe(1);
    expect(progress.cardState(card)).toBe("know");
    expect(progress.understandingOf(1)).toBe(7);
    expect(progress.understandingOf(2)).toBeNull();
    expect(progress.lastChapter).toBe(2);
    expect(stores.explain.view).toBe("code");
  });

  it("changes solved only by the server's verdict, and solved stays solved", () => {
    const { stores } = testStores();
    const { progress } = stores;
    progress.confirmAttempt("n01-q-00000001", false);
    expect(progress.isSolved("n01-q-00000001")).toBe(false);
    progress.confirmAttempt("n01-q-00000001", true);
    progress.confirmAttempt("n01-q-00000001", false);
    expect(progress.isSolved("n01-q-00000001")).toBe(true);
    expect(progress.solvedIn("n01")).toBe(1);
  });

  it("shows a card mark at once and saves it with a key of its own", async () => {
    const { stores, api } = testStores();
    stores.progress.markCard(card, "know");
    expect(stores.progress.cardState(card)).toBe("know");
    expect(stores.sync.statusOf(cardSaveKey(card))).toBe("saving");
    await flush();
    expect(api.saveCard).toHaveBeenCalledWith({
      slug: "nodejs-internals",
      id: card,
      state: "know",
      idempotencyKey: "key-1",
    });
    expect(stores.sync.statusOf(cardSaveKey(card))).toBe("saved");
  });

  it("keeps an unsaved mark visible and retries it with the same key", async () => {
    const saveCard = vi
      .fn<(input: CardInput) => Promise<WriteOutcome>>()
      .mockResolvedValueOnce({ kind: "failed" })
      .mockResolvedValueOnce({ kind: "ok" });
    const { stores } = testStores({}, { api: fakeApi({ saveCard }) });
    stores.progress.markCard(card, "again");
    await flush();
    expect(stores.progress.cardState(card)).toBe("again");
    expect(stores.sync.statusOf(cardSaveKey(card))).toBe("failed");
    await stores.sync.retry(cardSaveKey(card));
    expect(saveCard.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      "key-1",
      "key-1",
    ]);
    expect(stores.sync.statusOf(cardSaveKey(card))).toBe("saved");
  });

  it("puts back what the server has when a mark is refused for good", async () => {
    const saveCard = vi.fn(
      async (_: CardInput): Promise<WriteOutcome> => ({ kind: "forbidden" }),
    );
    const { stores } = testStores(
      { progress: { ...emptyProgress, cards: { [card]: "know" } } },
      { api: fakeApi({ saveCard }) },
    );
    stores.progress.markCard(card, "again");
    expect(stores.progress.cardState(card)).toBe("again");
    await flush();
    expect(stores.progress.cardState(card)).toBe("know");
    expect(stores.sync.statusOf(cardSaveKey(card))).toBe("forbidden");
    expect(stores.sync.canRetry(cardSaveKey(card))).toBe(false);
  });

  it("does not undo a newer mark when an older one is refused", async () => {
    let refuse = true;
    const saveCard = vi.fn(
      async (_: CardInput): Promise<WriteOutcome> =>
        refuse ? { kind: "not-found" } : { kind: "ok" },
    );
    const { stores } = testStores({}, { api: fakeApi({ saveCard }) });
    stores.progress.markCard(card, "again");
    refuse = false;
    stores.progress.markCard(card, "know");
    await flush();
    expect(stores.progress.cardState(card)).toBe("know");
  });

  it("signed out, keeps marks on the page and sends nothing", async () => {
    const { stores, api } = testStores({ signedIn: false, progress: null });
    stores.progress.markCard(card, "know");
    stores.progress.openChapter(1);
    await flush();
    expect(stores.progress.cardState(card)).toBe("know");
    expect(api.saveCard).not.toHaveBeenCalled();
    expect(api.savePosition).not.toHaveBeenCalled();
    expect(stores.sync.statusOf(cardSaveKey(card))).toBeNull();
  });

  it("remembers the open chapter once per chapter", async () => {
    const { stores, api } = testStores();
    stores.progress.openChapter(3);
    stores.progress.openChapter(3);
    await flush();
    expect(api.savePosition).toHaveBeenCalledTimes(1);
    expect(api.savePosition).toHaveBeenCalledWith({
      slug: "nodejs-internals",
      lastChapter: 3,
    });
    expect(stores.progress.lastChapter).toBe(3);
  });
});
