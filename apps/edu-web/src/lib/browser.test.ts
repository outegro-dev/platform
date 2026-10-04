import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { newIdempotencyKey } from "./browser";

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("Idempotency-Key", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a version 4 UUID, as edu-backend expects", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(uuidV4);
    expect(z.uuid().safeParse(key).success).toBe(true);
    expect(newIdempotencyKey()).not.toBe(key);
  });

  it("is built from random bytes where randomUUID is missing (plain http)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: <T extends ArrayBufferView>(array: T) =>
        webcrypto.getRandomValues(
          array as unknown as Uint8Array,
        ) as unknown as T,
    });
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(uuidV4);
      expect(z.uuid().safeParse(key).success).toBe(true);
    }
  });
});
