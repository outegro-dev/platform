import { makeAutoObservable } from "mobx";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SOUND_KEY = "bs:sound";

/** Per-device preferences: sound (off by default) and reduced motion from the OS. */
export class PreferencesStore {
  sound = false;
  reducedMotion = false;
  /** The page is hidden: animations are pointless, events apply at once. */
  hidden = false;

  constructor(private readonly storage: KeyValueStorage | null = null) {
    makeAutoObservable<PreferencesStore, "storage">(this, { storage: false });
    try {
      this.sound = storage?.getItem(SOUND_KEY) === "on";
    } catch {
      this.sound = false;
    }
  }

  setSound(on: boolean): void {
    this.sound = on;
    try {
      this.storage?.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      // Private mode or blocked storage: the choice lasts for this tab.
    }
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  /** Scales animation lengths: full, minimal fades, or none while hidden. */
  duration(fullMs: number): number {
    if (this.hidden) return 0;
    return this.reducedMotion ? Math.min(fullMs, 160) : fullMs;
  }
}
