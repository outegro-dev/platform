import { describe, expect, it } from "vitest";
import {
  battleshipFeatures,
  clientMessageSchema,
  cosmeticUnlocked,
  defaultCosmetics,
  effectiveCosmetics,
  nicknameSchema,
  roomCodeSchema,
  serverMessageSchema,
  updateProfileSchema,
} from "./battleship.js";
import { battleshipMatchFinished, permissionsOf } from "./index.js";

describe("client messages", () => {
  it("accepts the documented commands", () => {
    for (const message of [
      { type: "queue.join", seq: 1, payload: { mode: "quick" } },
      { type: "bot.start", seq: 2, payload: { level: "expert" } },
      { type: "room.join", seq: 3, payload: { code: "K7M2QX" } },
      { type: "shot.fire", seq: 4, payload: { x: 9, y: 0 } },
      { type: "match.resign", seq: 5, payload: {} },
      { type: "ping", seq: 6, payload: { t: 1 } },
    ]) {
      expect(clientMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it("rejects unknown types, off-board shots and extra fields", () => {
    for (const message of [
      { type: "admin.win", seq: 1, payload: {} },
      { type: "shot.fire", seq: 1, payload: { x: 10, y: 0 } },
      { type: "shot.fire", seq: 1, payload: { x: 0.5, y: 0 } },
      { type: "match.resign", seq: 1, payload: { winner: "me" } },
      { type: "ping", seq: 0, payload: { t: 1 } },
    ]) {
      expect(clientMessageSchema.safeParse(message).success).toBe(false);
    }
  });
});

describe("server messages", () => {
  it("parses a shot result that sinks a ship", () => {
    const parsed = serverMessageSchema.parse({
      type: "shot.result",
      seq: 12,
      payload: {
        by: "opponent",
        x: 9,
        y: 9,
        outcome: "sunk",
        ship: { x: 9, y: 9, length: 1, orientation: "horizontal" },
        revealed: [
          { x: 8, y: 8 },
          { x: 9, y: 8 },
          { x: 8, y: 9 },
        ],
        nextTurn: "opponent",
        deadline: "2026-09-29T12:00:30.000Z",
      },
    });
    expect(parsed.type).toBe("shot.result");
  });

  it("never carries user ids in a match snapshot", () => {
    const snapshot = serverMessageSchema.parse({
      type: "match.state",
      seq: 1,
      payload: {
        match: {
          matchId: "00000000-0000-4000-8000-000000000001",
          mode: "quick",
          rated: true,
          phase: "battle",
          opponent: {
            kind: "human",
            nickname: "Sailor 4821",
            rating: 1016,
            premium: false,
            userId: "00000000-0000-4000-8000-000000000009",
          },
          turn: "you",
          deadline: null,
          winner: null,
          reason: null,
          moves: 3,
          yourFleetPlaced: true,
          opponentFleetPlaced: true,
          opponentConnected: true,
          own: null,
          target: null,
          opponentFleet: null,
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("000000000009");
  });
});

describe("cosmetics", () => {
  const none = new Set<string>();
  const silver = new Set<string>([battleshipFeatures.silverFleet]);
  const premium = new Set<string>([battleshipFeatures.premium]);
  const chosen = {
    ships: "silver",
    hitEffect: "shards",
    theme: "night-sea",
  } as const;

  it("free items are always available, paid ones need the grant or Premium", () => {
    expect(cosmeticUnlocked("ships", "classic", none)).toBe(true);
    expect(cosmeticUnlocked("ships", "silver", none)).toBe(false);
    expect(cosmeticUnlocked("ships", "silver", silver)).toBe(true);
    expect(cosmeticUnlocked("theme", "night-sea", premium)).toBe(true);
  });

  it("falls back to defaults when the grant is gone (TC-BS-09)", () => {
    expect(effectiveCosmetics(chosen, silver)).toEqual(chosen);
    expect(effectiveCosmetics(chosen, none)).toEqual(defaultCosmetics);
  });
});

describe("profile input", () => {
  it("validates nicknames and room codes", () => {
    expect(nicknameSchema.safeParse("Капитан Немо").success).toBe(true);
    expect(nicknameSchema.safeParse("ab").success).toBe(false);
    expect(nicknameSchema.safeParse("<script>").success).toBe(false);
    expect(roomCodeSchema.safeParse("K7M2QX").success).toBe(true);
    expect(roomCodeSchema.safeParse("K0M2QX").success).toBe(false);
  });

  it("rejects an empty update", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(
      updateProfileSchema.safeParse({ cosmetics: { theme: "day" } }).success,
    ).toBe(true);
  });
});

describe("platform wiring", () => {
  it("defines the match-finished event for the battleship producer", () => {
    expect(battleshipMatchFinished.producer).toBe("battleship");
    expect(battleshipMatchFinished.schemaVersion).toBe(1);
  });

  it("gives support read and moderation of the game, not billing", () => {
    const support = permissionsOf(["support"]);
    expect(support.has("battleship.moderate")).toBe(true);
    expect(support.has("billing.read")).toBe(false);
  });
});
