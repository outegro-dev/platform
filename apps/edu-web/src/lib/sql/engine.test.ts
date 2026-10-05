import { describe, expect, it } from "vitest";
import { SqlEngine } from "./engine";
import type { RunRequest, WorkerMessage } from "./protocol";

type Listener = (event: never) => void;

/**
 * A worker in memory: `behave` answers each request (or the worker fails
 * to load, as one whose script cannot be fetched does).
 */
class FakeWorker {
  private readonly listeners = new Map<string, Set<Listener>>();
  terminated = false;

  constructor(
    private readonly behave: (request: RunRequest, worker: FakeWorker) => void,
  ) {}

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(request: RunRequest) {
    queueMicrotask(() => this.behave(request, this));
  }

  terminate() {
    this.terminated = true;
  }

  reply(message: WorkerMessage) {
    for (const listener of this.listeners.get("message") ?? [])
      (listener as (event: { data: WorkerMessage }) => void)({ data: message });
  }

  fail() {
    for (const listener of this.listeners.get("error") ?? [])
      (listener as (event: { preventDefault(): void }) => void)({
        preventDefault() {},
      });
  }
}

const fails = () => new FakeWorker((_, worker) => worker.fail());
const answers = () =>
  new FakeWorker((request, worker) => {
    worker.reply({ id: request.id, type: "started" });
    worker.reply({
      id: request.id,
      type: "done",
      results: [{ columns: ["n"], values: [[1]] }],
    });
  });

function engineWith(workers: FakeWorker[], online: { value: boolean }) {
  const spawned: FakeWorker[] = [];
  const engine = new SqlEngine(
    () => {
      const next = workers.shift();
      if (!next) throw new Error("no worker left");
      spawned.push(next);
      return next as unknown as Worker;
    },
    () => online.value,
  );
  return { engine, spawned };
}

describe("SqlEngine", () => {
  it("offline, an engine that does not load is offline; back online, the next run loads a new one", async () => {
    const online = { value: false };
    const { engine, spawned } = engineWith([fails(), answers()], online);
    expect(await engine.run("seed", "SELECT 1")).toEqual({ kind: "offline" });
    expect(spawned[0]?.terminated).toBe(true);
    online.value = true;
    expect(await engine.run("seed", "SELECT 1")).toEqual({
      kind: "ok",
      results: [{ columns: ["n"], values: [[1]] }],
    });
    expect(spawned).toHaveLength(2);
  });

  it("online, an engine that does not load is broken", async () => {
    const { engine } = engineWith([fails()], { value: true });
    expect(await engine.run("seed", "SELECT 1")).toEqual({ kind: "engine" });
  });

  it("a worker that cannot even be created offline is offline too", async () => {
    const engine = new SqlEngine(
      () => {
        throw new Error("blocked");
      },
      () => false,
    );
    expect(await engine.run("seed", "SELECT 1")).toEqual({ kind: "offline" });
  });

  it("SQLite's own errors stay errors, whatever the connection", async () => {
    const worker = new FakeWorker((request, self) => {
      self.reply({ id: request.id, type: "started" });
      self.reply({
        id: request.id,
        type: "error",
        message: "no such table: x",
        fatal: false,
      });
    });
    const { engine } = engineWith([worker], { value: false });
    expect(await engine.run("seed", "SELECT * FROM x")).toEqual({
      kind: "error",
      message: "no such table: x",
    });
    expect(worker.terminated).toBe(false);
  });
});
