import type { SoundCue, SoundPlayer } from "../stores/sound";

type Tone = {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  gain: number;
  delay?: number;
};

/** Each cue is a few synthesized tones or a noise burst: no audio files. */
const cues: Record<
  SoundCue,
  {
    tones?: Tone[];
    noise?: { duration: number; gain: number; lowpass: number };
  }
> = {
  fire: {
    tones: [
      { type: "triangle", from: 520, to: 160, duration: 0.18, gain: 0.12 },
    ],
  },
  miss: {
    tones: [
      { type: "sine", from: 420, to: 300, duration: 0.22, gain: 0.08 },
      {
        type: "sine",
        from: 300,
        to: 220,
        duration: 0.3,
        gain: 0.05,
        delay: 0.08,
      },
    ],
  },
  hit: {
    noise: { duration: 0.35, gain: 0.32, lowpass: 900 },
    tones: [{ type: "square", from: 140, to: 60, duration: 0.25, gain: 0.08 }],
  },
  sunk: {
    noise: { duration: 0.8, gain: 0.34, lowpass: 600 },
    tones: [{ type: "sawtooth", from: 110, to: 40, duration: 0.8, gain: 0.08 }],
  },
  turn: {
    tones: [
      { type: "sine", from: 660, to: 660, duration: 0.09, gain: 0.07 },
      {
        type: "sine",
        from: 880,
        to: 880,
        duration: 0.12,
        gain: 0.07,
        delay: 0.1,
      },
    ],
  },
  place: {
    tones: [
      { type: "triangle", from: 300, to: 380, duration: 0.07, gain: 0.06 },
    ],
  },
  win: {
    tones: [
      { type: "triangle", from: 523, to: 523, duration: 0.16, gain: 0.08 },
      {
        type: "triangle",
        from: 659,
        to: 659,
        duration: 0.16,
        gain: 0.08,
        delay: 0.14,
      },
      {
        type: "triangle",
        from: 784,
        to: 784,
        duration: 0.16,
        gain: 0.08,
        delay: 0.28,
      },
      {
        type: "triangle",
        from: 1047,
        to: 1047,
        duration: 0.4,
        gain: 0.08,
        delay: 0.42,
      },
    ],
  },
  lose: {
    tones: [
      { type: "sine", from: 392, to: 370, duration: 0.3, gain: 0.08 },
      {
        type: "sine",
        from: 330,
        to: 311,
        duration: 0.3,
        gain: 0.08,
        delay: 0.28,
      },
      {
        type: "sine",
        from: 262,
        to: 220,
        duration: 0.6,
        gain: 0.08,
        delay: 0.56,
      },
    ],
  },
};

/**
 * Optional game sounds synthesized with Web Audio. Off by default; the audio
 * context is created on the first cue after the player turns sound on (a
 * user gesture, as browsers require).
 */
export class SoundEngine implements SoundPlayer {
  private context: AudioContext | null = null;

  constructor(private readonly enabled: () => boolean) {}

  play(cue: SoundCue): void {
    if (!this.enabled()) return;
    const context = this.ensureContext();
    if (!context) return;
    const spec = cues[cue];
    const start = context.currentTime + 0.01;
    for (const tone of spec.tones ?? []) this.tone(context, tone, start);
    if (spec.noise) this.noise(context, spec.noise, start);
  }

  /** Unlocks audio from a click handler (the sound toggle). */
  unlock(): void {
    const context = this.ensureContext();
    void context?.resume().catch(() => undefined);
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Context =
      typeof window === "undefined"
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext);
    if (!Context) return null;
    try {
      this.context = new Context();
    } catch {
      return null;
    }
    return this.context;
  }

  private tone(context: AudioContext, tone: Tone, start: number): void {
    const at = start + (tone.delay ?? 0);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.from, at);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, tone.to),
      at + tone.duration,
    );
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(tone.gain, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + tone.duration + 0.05);
  }

  private noise(
    context: AudioContext,
    noise: { duration: number; gain: number; lowpass: number },
    start: number,
  ): void {
    const length = Math.floor(context.sampleRate * noise.duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Decaying white noise: a muffled blast.
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = noise.lowpass;
    const gain = context.createGain();
    gain.gain.value = noise.gain;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(start);
  }
}
