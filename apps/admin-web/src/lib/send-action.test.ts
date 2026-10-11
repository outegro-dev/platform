import { describe, expect, it, vi } from "vitest";
import { isUnsent, sendAction } from "./send-action";

const done = { status: "success", message: "Access granted." } as const;
const now = () => 1_000;

describe("sending a command from a form", () => {
  it("returns the server's answer when there is one", async () => {
    const send = vi.fn(async () => done);
    expect(await sendAction(send, () => true, now)).toBe(done);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send anything offline", async () => {
    const send = vi.fn(async () => done);
    expect(await sendAction(send, () => false, now)).toEqual({
      status: "offline",
      at: 1_000,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("turns a request that got no answer into a failed state, not an error", async () => {
    const send = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendAction(send, () => true, now)).toEqual({
      status: "failed",
      at: 1_000,
    });
  });

  it("calls it offline when the connection went while the request was out", async () => {
    let online = true;
    const send = vi.fn(async () => {
      online = false;
      throw new TypeError("Failed to fetch");
    });
    expect(await sendAction(send, () => online, now)).toEqual({
      status: "offline",
      at: 1_000,
    });
  });

  it("tells an unsent command from the server's answers", () => {
    expect(isUnsent({ status: "offline" })).toBe(true);
    expect(isUnsent({ status: "failed" })).toBe(true);
    for (const status of ["idle", "success", "error"])
      expect(isUnsent({ status }), status).toBe(false);
  });
});
