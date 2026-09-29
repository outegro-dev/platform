export type SoundCue =
  | "fire"
  | "miss"
  | "hit"
  | "sunk"
  | "turn"
  | "place"
  | "win"
  | "lose";

/** What stores need from the sound engine. */
export interface SoundPlayer {
  play(cue: SoundCue): void;
}

export const silence: SoundPlayer = { play: () => {} };
