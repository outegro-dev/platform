import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IdleSessionStore } from "./idle-store";
import { ToastStore } from "./toast-store";

const MINUTE = 60_000;

function idle(start = 0) {
  const effects = { keepalive: vi.fn(), signOut: vi.fn(), broadcast: vi.fn() };
  return { store: new IdleSessionStore(effects, start), effects };
}

describe("idle sign-out", () => {
  it("warns two minutes ahead and signs out after 30 idle minutes", () => {
    const { store, effects } = idle();
    store.tick(27 * MINUTE);
    expect(store.warning).toBe(false);
    store.tick(28 * MINUTE);
    expect(store.warning).toBe(true);
    expect(store.secondsLeft).toBe(120);
    store.tick(29 * MINUTE + 30_000);
    expect(store.secondsLeft).toBe(30);
    store.tick(30 * MINUTE);
    expect(effects.signOut).toHaveBeenCalledTimes(1);
    store.tick(31 * MINUTE);
    expect(effects.signOut).toHaveBeenCalledTimes(1);
    expect(store.warning).toBe(false);
  });

  it("resets on activity, pings the server at most once a minute", () => {
    const { store, effects } = idle();
    store.activity(10 * MINUTE);
    store.activity(10 * MINUTE + 2000);
    expect(effects.keepalive).toHaveBeenCalledTimes(1);
    expect(effects.broadcast).toHaveBeenCalledTimes(1);
    store.activity(10 * MINUTE + 30_000);
    expect(effects.keepalive).toHaveBeenCalledTimes(1);
    store.activity(11 * MINUTE + 10_000);
    expect(effects.keepalive).toHaveBeenCalledTimes(2);
    store.tick(39 * MINUTE);
    expect(store.warning).toBe(false);
  });

  it("needs an explicit choice once the warning is open", () => {
    const { store, effects } = idle();
    store.tick(28 * MINUTE + 10_000);
    store.activity(28 * MINUTE + 20_000);
    expect(store.warning).toBe(true);
    store.extend(28 * MINUTE + 30_000);
    expect(store.warning).toBe(false);
    expect(effects.keepalive).toHaveBeenCalledTimes(1);
  });

  it("follows activity from other tabs", () => {
    const { store, effects } = idle();
    store.remoteActivity(25 * MINUTE);
    store.tick(50 * MINUTE);
    expect(effects.signOut).not.toHaveBeenCalled();
    store.tick(55 * MINUTE);
    expect(effects.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("toasts", () => {
  it("keeps three at most and dismisses them on a timer", () => {
    const timers: { callback: () => void; handle: number }[] = [];
    let next = 0;
    const store = new ToastStore({
      set: (callback) => {
        timers.push({ callback, handle: ++next });
        return next;
      },
      clear: () => undefined,
    });
    for (const text of ["a", "b", "c", "d"]) store.push("ok", text);
    expect(store.items.map((toast) => toast.text)).toEqual(["b", "c", "d"]);
    timers.at(-1)?.callback();
    expect(store.items.map((toast) => toast.text)).toEqual(["b", "c"]);
  });
});

describe("MobX observers and the React Compiler", () => {
  it('every observer component opts out with "use no memo"', () => {
    const root = path.resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".tsx")) files.push(full);
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(
        /observer\(\s*function\s+(\w+)\([^)]*\)[^{]*\{\s*("use no memo"|'use no memo')?/gs,
      )) {
        if (!match[2])
          offenders.push(`${path.relative(root, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(
      files.some((file) => readFileSync(file, "utf8").includes("observer(")),
    ).toBe(true);
  });
});
