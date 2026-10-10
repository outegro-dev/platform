/*
 * Wood knocks, a whoosh and the bonk, synthesised with Web Audio: no files to
 * download, and nothing plays unless the visitor pressed the retry button.
 */

let context: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

function noise(ctx: AudioContext, seconds: number) {
  const buffer = ctx.createBuffer(
    1,
    Math.ceil(ctx.sampleRate * seconds),
    ctx.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

/** A hollow wooden "tung": a falling tone with a short click on top. */
export function knock(pitch = 1, volume = 0.22) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  const tone = ctx.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(420 * pitch, t);
  tone.frequency.exponentialRampToValueAtTime(190 * pitch, t + 0.12);
  tone.connect(gain);
  tone.start(t);
  tone.stop(t + 0.2);

  const click = noise(ctx, 0.03);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800 * pitch;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(volume * 0.6, t);
  clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  click.connect(band).connect(clickGain).connect(ctx.destination);
  click.start(t);
}

export function whoosh(volume = 0.16) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const source = noise(ctx, 0.22);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(500, t);
  filter.frequency.exponentialRampToValueAtTime(3200, t + 0.16);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(t);
}

/** The hit: a deep wooden thud with a cartoon pitch drop. */
export function bonk(volume = 0.32) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
  const tone = ctx.createOscillator();
  tone.type = "square";
  tone.frequency.setValueAtTime(260, t);
  tone.frequency.exponentialRampToValueAtTime(70, t + 0.3);
  const soften = ctx.createBiquadFilter();
  soften.type = "lowpass";
  soften.frequency.value = 900;
  tone.connect(soften).connect(gain);
  tone.start(t);
  tone.stop(t + 0.45);
  knock(0.8, volume * 0.8);
}
