import { makeAutoObservable } from "mobx";

/** Where the choice is remembered (localStorage in the app, a map in tests). */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "og_roulette_sound";

export type Blip = "bet" | "stop" | "win" | "mega" | "green";

/** Notes of each blip: frequency (Hz), start and length (s). */
const melodies: Record<Blip, [number, number, number][]> = {
  bet: [[660, 0, 0.06]],
  stop: [[440, 0, 0.09]],
  win: [
    [523, 0, 0.1],
    [784, 0.1, 0.16],
  ],
  mega: [
    [392, 0, 0.08],
    [523, 0.08, 0.08],
    [659, 0.16, 0.2],
  ],
  green: [
    [523, 0, 0.09],
    [659, 0.09, 0.09],
    [784, 0.18, 0.09],
    [1047, 0.27, 0.26],
  ],
};

/** The part of AudioContext this uses (a fake in tests). */
export type AudioLike = Pick<
  AudioContext,
  "currentTime" | "destination" | "createOscillator" | "createGain" | "resume"
> & { state: string };

/**
 * Short WebAudio blips instead of sound files. Nothing plays before the
 * player's first action on the page (browsers would refuse it anyway, and
 * a game should not start beeping by itself); the switch turns them off
 * for good and is remembered.
 */
export class SoundBlips {
  enabled = true;
  private unlocked = false;
  private context: AudioLike | null = null;

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly createContext: () => AudioLike | null = browserAudio,
  ) {
    this.enabled = storage?.getItem(STORAGE_KEY) !== "off";
    makeAutoObservable<
      SoundBlips,
      "unlocked" | "context" | "storage" | "createContext"
    >(
      this,
      { unlocked: false, context: false, storage: false, createContext: false },
      { autoBind: true },
    );
  }

  /** The player's first click or key: from now on sound may play. */
  unlock(): void {
    this.unlocked = true;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.unlocked = true;
    try {
      this.storage?.setItem(STORAGE_KEY, this.enabled ? "on" : "off");
    } catch {
      // Private mode or blocked storage: the switch still works for this page.
    }
  }

  /** True when the blip was scheduled. */
  play(blip: Blip): boolean {
    if (!this.enabled || !this.unlocked) return false;
    this.context ??= this.createContext();
    const context = this.context;
    if (!context) return false;
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    for (const [frequency, at, length] of melodies[blip]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.06, start + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + length + 0.02);
    }
    return true;
  }
}

function browserAudio(): AudioLike | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}
