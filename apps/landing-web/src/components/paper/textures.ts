import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

/*
 * Procedural paper: notebook lines, green grid paper, blue sea strips and the
 * pier sign. Everything is drawn once into small canvases and tiled.
 */

export const INK = "#1d1b17";
export const PAPER = "#fbf7ec";
export const PAPER_BACK = "#efe9da";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return { element, ctx };
}

function texture(element: HTMLCanvasElement, repeat = true) {
  const map = new CanvasTexture(element);
  map.colorSpace = SRGBColorSpace;
  map.minFilter = LinearMipmapLinearFilter;
  if (repeat) {
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
  }
  map.anisotropy = 8;
  return map;
}

/** Fibres and specks so flat colour reads as paper. */
function grain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  strength = 1,
) {
  const random = rng(seed);
  for (let i = 0; i < (width * height) / 90; i++) {
    const dark = random() < 0.5;
    ctx.fillStyle = dark
      ? `rgba(90,70,40,${0.035 * strength})`
      : `rgba(255,255,255,${0.08 * strength})`;
    ctx.fillRect(
      random() * width,
      random() * height,
      1 + random() * 2.5,
      1 + random() * 1.2,
    );
  }
}

/** A wobbly marker line from (x0, y) to (x1, y). */
function wobblyLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  random: () => number,
  amplitude: number,
) {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  for (let x = x0; x <= x1; x += 32) {
    ctx.lineTo(x, y + (random() - 0.5) * amplitude);
  }
  ctx.lineTo(x1, y);
  ctx.stroke();
}

/** Lined notebook paper: one tile is 16 rules (LINE world units apart). */
export function linedPaper() {
  const size = 512;
  const { element, ctx } = canvas(size, size);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, size, 7);
  ctx.strokeStyle = "rgba(92,150,210,0.55)";
  ctx.lineWidth = 2.2;
  const random = rng(11);
  for (let i = 0; i < 16; i++) {
    const y = i * 32 + 16;
    wobblyLine(ctx, -8, size + 8, y, random, 0.8);
  }
  return texture(element);
}
/** World size of one lined tile. */
export const LINED_TILE = 5.6;

/** Green grid paper for the land. */
export function gridPaper() {
  const size = 256;
  const { element, ctx } = canvas(size, size);
  ctx.fillStyle = "#bfe2a0";
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, size, 3, 1.4);
  for (let i = 0; i <= 16; i++) {
    const major = i % 4 === 0;
    ctx.strokeStyle = major ? "rgba(46,120,52,0.55)" : "rgba(60,140,70,0.32)";
    ctx.lineWidth = major ? 2.4 : 1.2;
    const p = i * 16;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  return texture(element);
}
export const GRID_TILE = 2.2;

/** Flat sea: strips of blue paper glued side by side, hatched with marker. */
export function seaPaper() {
  const width = 256;
  const height = 256;
  const { element, ctx } = canvas(width, height);
  const blues = ["#8ccaf0", "#79bbe8", "#9dd4f3", "#6eb2e2"];
  const random = rng(5);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = blues[i];
    ctx.fillRect(0, i * 64, width, 64);
    ctx.strokeStyle = "rgba(30,90,160,0.28)";
    ctx.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      const y = i * 64 + 8 + random() * 48;
      const x = random() * width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 12, y - 6, x + 24, y);
      ctx.quadraticCurveTo(x + 36, y + 6, x + 48, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(0, i * 64, width, 2);
  }
  grain(ctx, width, height, 9, 1.2);
  return texture(element);
}
export const SEA_TILE = 3.2;

/**
 * The cut end of a strip, drawn on its own tile: the edge curves down to the
 * bottom over `length` px (`shape` lifts it from 0 at the tip to 1), so the
 * strip ends in a slope instead of a straight vertical cut.
 */
type Taper = {
  side: "start" | "end";
  length: number;
  shape: (t: number) => number;
};

/**
 * A long strip with a wavy (or hilly) top edge: white paper border, marker
 * outline, hatched fill. Transparent above the edge; tiles horizontally,
 * except a tapered end tile.
 */
function edgeStrip(
  height: number,
  edge: (x: number) => number,
  fill: (ctx: CanvasRenderingContext2D, height: number) => void,
  seed: number,
  taper?: Taper,
) {
  const width = 512;
  const { element, ctx } = canvas(width, height);
  // Near-transparent white, so filtered edges fade to paper, not to black.
  ctx.fillStyle = "rgba(255,255,255,0.01)";
  ctx.fillRect(0, 0, width, height);
  let from = -24;
  let to = width + 24;
  let top = edge;
  if (taper) {
    // The tip sits inside the tile, so its paper border is not cut off.
    const tip = taper.side === "start" ? 16 : width - 16;
    const ground = height + 12;
    if (taper.side === "start") from = tip;
    else to = tip;
    top = (x) => {
      const t = Math.min(1, Math.abs(x - tip) / taper.length);
      return ground + (edge(x) - ground) * taper.shape(t);
    };
  }
  const path = new Path2D();
  path.moveTo(from, top(from));
  for (let x = from; x < to; x += 4) path.lineTo(x, top(x));
  path.lineTo(to, top(to));
  const body = new Path2D(path);
  body.lineTo(to, height + 4);
  body.lineTo(from, height + 4);
  body.closePath();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 22;
  ctx.stroke(path);
  ctx.save();
  ctx.clip(body);
  fill(ctx, height);
  grain(ctx, width, height, seed, 1.2);
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke(path);
  const map = texture(element);
  // Repeat along the strip only: a vertical repeat bleeds the fill over the edge.
  map.wrapT = ClampToEdgeWrapping;
  if (taper) map.wrapS = ClampToEdgeWrapping;
  return map;
}

/**
 * Standing wave strips: TAU-periodic over the tile so they tile seamlessly.
 * With `end`, the tile is the strip's first one, rounded off at the left
 * where the sea washes up on the shore.
 */
export function waveStrip(
  fillColor: string,
  phase: number,
  seed: number,
  end = false,
) {
  const height = 150;
  return edgeStrip(
    height,
    (x) => {
      const a = (x / 512) * Math.PI * 2;
      return 46 + Math.sin(a * 2 + phase) * 18 + Math.sin(a * 6 + phase) * 5;
    },
    (ctx, h) => {
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, 512, h);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 3;
      const random = rng(seed);
      for (let k = 0; k < 40; k++) {
        const x = random() * 560 - 24;
        const y = 50 + random() * (h - 50);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18 + random() * 20, y - 8 - random() * 6);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(20,70,140,0.35)";
      ctx.lineWidth = 2.5;
      for (let k = 0; k < 10; k++) {
        const x = random() * 512;
        const y = 70 + random() * (h - 80);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 10, y - 7, x + 20, y);
        ctx.quadraticCurveTo(x + 30, y + 7, x + 40, y);
        ctx.stroke();
      }
    },
    seed,
    // A quarter circle: the cut end of a paper strip.
    end
      ? {
          side: "start",
          length: 120,
          shape: (t) => Math.sqrt(1 - (1 - t) ** 2),
        }
      : undefined,
  );
}

/**
 * Rolling hills of grid paper behind the land stations. With `end`, the
 * tile is the strip's last one, sloping down to the coast at the right.
 */
export function hillStrip(
  grid: HTMLCanvasElement | null,
  seed: number,
  end = false,
) {
  const height = 256;
  return edgeStrip(
    height,
    (x) => {
      const a = (x / 512) * Math.PI * 2;
      return (
        96 - Math.sin(a + seed) * 46 - Math.sin(a * 2 + seed * 2) * 26 + 20
      );
    },
    (ctx, h) => {
      ctx.fillStyle = "#a9d78a";
      ctx.fillRect(0, 0, 512, h);
      if (grid) {
        const pattern = ctx.createPattern(grid, "repeat");
        if (pattern) {
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, 512, h);
          ctx.globalAlpha = 1;
        }
      }
      ctx.fillStyle = "rgba(40,110,50,0.12)";
      ctx.fillRect(0, h * 0.62, 512, h);
    },
    seed + 20,
    end
      ? { side: "end", length: 340, shape: (t) => 1 - (1 - t) ** 2 }
      : undefined,
  );
}

/** Soft shade along the crease where the two pages meet. */
export function creaseShade() {
  const { element, ctx } = canvas(4, 128);
  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, "rgba(70,50,20,0)");
  gradient.addColorStop(1, "rgba(70,50,20,0.22)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 128);
  const map = texture(element, false);
  return map;
}

function cssFamily(name: string) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * "ПРИЧАЛ №1" for the blank pier sign. Tries the page's wide heavy face
 * (Unbounded 900 behind --og-sign-*), falls back to a system black weight.
 */
export async function signText(lines: string[]) {
  const families = [
    cssFamily("--og-sign-cyrillic"),
    cssFamily("--og-sign-latin"),
    '"Arial Black"',
    "sans-serif",
  ]
    .filter(Boolean)
    .join(", ");
  const font = (size: number) => `900 ${size}px ${families}`;
  try {
    await Promise.race([
      document.fonts.load(font(96), lines.join(" ")),
      new Promise((resolve) => setTimeout(resolve, 1800)),
    ]);
  } catch {
    // Unknown family list: the fallback faces below still draw.
  }
  const width = 512;
  const height = 280;
  const { element, ctx } = canvas(width, height);
  ctx.fillStyle = "rgba(255,255,255,0.01)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const sizes = [104, 120];
  lines.forEach((line, i) => {
    let size = sizes[i] ?? 100;
    ctx.font = font(size);
    while (ctx.measureText(line).width > width * 0.9 && size > 24) {
      size -= 4;
      ctx.font = font(size);
    }
    ctx.save();
    ctx.translate(width / 2, (height / (lines.length + 0.4)) * (i + 0.7));
    ctx.rotate(i === 0 ? -0.03 : 0.04);
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });
  return texture(element, false);
}
