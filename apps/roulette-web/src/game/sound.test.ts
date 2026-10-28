import { describe, expect, it } from "vitest";
import { type AudioLike, SoundBlips } from "./sound";

function fakeAudio() {
  const started: number[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const node = () => ({ connect: (next: unknown) => next });
  const context = {
    state: "running",
    currentTime: 1,
    destination: {},
    resume: async () => {},
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => ({
      ...node(),
      type: "sine",
      frequency: param(),
      start: (at: number) => started.push(at),
      stop() {},
    }),
  } as unknown as AudioLike;
  return { context, started };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("SoundBlips", () => {
  it("stays silent until the player's first action", () => {
    const audio = fakeAudio();
    const sound = new SoundBlips(memoryStorage(), () => audio.context);
    expect(sound.play("stop")).toBe(false);
    sound.unlock();
    expect(sound.play("green")).toBe(true);
    expect(audio.started.length).toBe(4);
  });

  it("remembers the switch", () => {
    const storage = memoryStorage();
    const audio = fakeAudio();
    const first = new SoundBlips(storage, () => audio.context);
    first.toggle();
    expect(first.enabled).toBe(false);
    expect(first.play("win")).toBe(false);
    const next = new SoundBlips(storage, () => audio.context);
    next.unlock();
    expect(next.enabled).toBe(false);
    expect(next.play("win")).toBe(false);
  });

  it("does nothing without WebAudio", () => {
    const sound = new SoundBlips(null, () => null);
    sound.unlock();
    expect(sound.play("mega")).toBe(false);
  });
});
