import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import { finishReasonOf } from "./match";

const finished = (reason: string | null, battleStartedAt: string | null) => ({
  status: "finished" as const,
  reason,
  battleStartedAt,
});
const started = "2026-09-29T14:03:00.000Z";

describe("why a match finished", () => {
  it("tells a loss on the placement clock from a timeout in battle", () => {
    expect(finishReasonOf(finished("timeout", null))).toBe("not_deployed");
    expect(finishReasonOf(finished("timeout", started))).toBe("timeout");
  });

  it("keeps every other reason as the server sent it", () => {
    for (const reason of ["fleet_destroyed", "resigned", "disconnected"]) {
      expect(finishReasonOf(finished(reason, started)), reason).toBe(reason);
      expect(finishReasonOf(finished(reason, null)), reason).toBe(reason);
    }
    expect(finishReasonOf(finished(null, null))).toBeNull();
  });

  it("says nothing for a match that has not finished", () => {
    for (const status of ["placement", "battle", "aborted"] as const)
      expect(
        finishReasonOf({ status, reason: null, battleStartedAt: null }),
      ).toBeNull();
  });

  it("names the placement loss in English and Russian", () => {
    expect(en.labels.finishReason.not_deployed).toBe("Did not deploy in time");
    expect(ru.labels.finishReason.not_deployed).toBe(
      "Не расставил флот вовремя",
    );
  });
});
