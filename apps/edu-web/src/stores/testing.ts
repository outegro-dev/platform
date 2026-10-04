import type { AssistEvent, ProgressResponse } from "@outegro/contracts/edu";
import { SeededRandom } from "@outegro/edu-engine";
import { type Mock, vi } from "vitest";
import type { AssistBodies, AssistKind } from "@/lib/assist/protocol";
import type { AssistReply, AssistTransport } from "@/lib/assist/transport";
import type { KeyValueStorage } from "@/lib/browser";
import type {
  AttemptInput,
  AttemptOutcome,
  CardInput,
  PositionInput,
  ReaderApi,
  WriteOutcome,
} from "@/lib/reader-api";
import type { RunOutcome, SqlRunner } from "@/lib/sql/engine";
import {
  createReaderStores,
  type ReaderInit,
  type ReaderServices,
} from "./reader-stores";

/*
 * Fakes for the stores' unit tests: the API, storage, the connection, keys
 * and the SQL runner, all in memory and steerable.
 */

/** A promise the test resolves when it wants (a request in flight). */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise((done) => setTimeout(done, 0));

export type FakeApi = {
  submitAttempt: Mock<ReaderApi["submitAttempt"]>;
  saveCard: Mock<ReaderApi["saveCard"]>;
  savePosition: Mock<ReaderApi["savePosition"]>;
};

export function fakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    submitAttempt: vi.fn(
      async (_: AttemptInput): Promise<AttemptOutcome> => ({
        kind: "ok",
        correct: true,
        solved: true,
      }),
    ),
    saveCard: vi.fn(
      async (_: CardInput): Promise<WriteOutcome> => ({ kind: "ok" }),
    ),
    savePosition: vi.fn(
      async (_: PositionInput): Promise<WriteOutcome> => ({ kind: "ok" }),
    ),
    ...overrides,
  };
}

export function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
    },
  };
}

/** Keys key-1, key-2… so a test can tell attempts apart. */
export function sequentialKeys() {
  let n = 0;
  return vi.fn(() => `key-${++n}`);
}

export function fakeRunner(
  answer: (seed: string, sql: string) => RunOutcome | Promise<RunOutcome>,
): SqlRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn(async (seed: string, sql: string) => answer(seed, sql)) };
}

/** One request the fake assistant received. */
export type AssistCall = {
  slug: string;
  kind: AssistKind;
  body: AssistBodies[AssistKind];
  signal: AbortSignal;
};

/**
 * A scripted stream: events the test pushes when it wants, ended by the
 * test or by an abort of the request (as fetch does).
 */
export function scriptedStream(signal: AbortSignal) {
  const queue: AssistEvent[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  signal.addEventListener("abort", poke);
  async function* events(): AsyncGenerator<AssistEvent> {
    for (;;) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  return {
    events: events(),
    push(...items: AssistEvent[]) {
      queue.push(...items);
      poke();
    },
    end() {
      ended = true;
      poke();
    },
  };
}

/**
 * The assistant in memory: every request is recorded; `reply` decides the
 * answer (by default a stream the test drives through `streams`).
 */
export function fakeTransport(
  reply?: (call: AssistCall) => AssistReply | Promise<AssistReply>,
) {
  const calls: AssistCall[] = [];
  const streams: ReturnType<typeof scriptedStream>[] = [];
  const transport: AssistTransport = {
    async ask(slug, kind, body, signal) {
      const call = { slug, kind, body, signal } as AssistCall;
      calls.push(call);
      if (reply) return reply(call);
      const stream = scriptedStream(signal);
      streams.push(stream);
      return { kind: "stream", events: stream.events };
    },
  };
  return { transport, calls, streams };
}

/** A complete answer's last event. */
export const doneEvent = (
  overrides: Partial<Extract<AssistEvent, { type: "done" }>> = {},
): AssistEvent => ({
  type: "done",
  cached: false,
  truncated: false,
  usedToday: 1,
  dailyLimit: 30,
  score: null,
  ...overrides,
});

export const emptyProgress: ProgressResponse = {
  exercises: {},
  cards: {},
  lastChapter: null,
  explainView: null,
  understanding: {},
};

/** The page's stores over fakes; the connection is a switch the test flips. */
export function testStores(
  init: Partial<ReaderInit> = {},
  services: Partial<Omit<ReaderServices, "api">> & { api?: FakeApi } = {},
) {
  const connection = { online: true };
  const api = services.api ?? fakeApi();
  const all: ReaderServices = {
    storage: memoryStorage(),
    isOnline: () => connection.online,
    newKey: sequentialKeys(),
    random: new SeededRandom(1),
    sql: fakeRunner(() => ({ kind: "engine" })),
    assist: fakeTransport().transport,
    now: () => new Date("2026-10-04T12:00:00.000Z"),
    ...services,
    api,
  };
  const stores = createReaderStores(
    {
      slug: "nodejs-internals",
      signedIn: true,
      progress: emptyProgress,
      sandboxSeed: null,
      shuffleSeed: 7,
      assist: { enabled: true, dailyLimit: 30, usedToday: 0 },
      ...init,
    },
    all,
  );
  return { stores, api, connection };
}
