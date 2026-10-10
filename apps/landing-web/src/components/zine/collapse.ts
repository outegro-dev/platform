/*
 * The page falls apart: the blocks on screen drop under gravity, bounce,
 * settle flat into a pile on a floor and can be thrown around; `rewind`
 * flies everything back. Plain DOM transforms and a height map for the pile,
 * no physics library: it only has to look right for a few seconds.
 */

const PIECES = [
  ".ransom-letter",
  ".cover-mast",
  ".cover-strip",
  ".cover-tagline",
  ".cover-lead",
  ".coverlines > li",
  ".cover-actions",
  ".cover-art",
  ".ticker",
  ".toc li",
  ".toc-title",
  ".section-index",
  ".section-title",
  ".section-lead",
  ".project-head",
  ".shot",
  ".project-shots > li",
  ".project-facts",
  ".platform-intro",
  ".platform-node",
  ".platform-layer > h3",
  ".ads-note",
  ".ad",
  ".process-step",
  ".price-tags > li",
  ".tags-note",
  ".engagement-subtitle",
  ".receipt-wrap",
  ".coupon",
  ".contact-links li",
  ".dont-press-button",
  ".dont-press-note",
  ".bonk-card",
  ".wordmark",
  ".desktop-nav",
  ".header-actions",
  ".bonk-replay",
].join(",");

const GRAVITY = 2600; // px/s²
const COLUMN = 12;

type Body = {
  el: HTMLElement;
  cx: number;
  cy: number;
  w: number;
  h: number;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  va: number;
  start: number;
  resting: boolean;
  transition: string;
};

export type Collapse = {
  /** Grab the topmost body under the pointer, or null. */
  grab: (px: number, py: number) => number | null;
  drag: (index: number, px: number, py: number) => void;
  release: (index: number) => void;
  rewind: (ms: number) => Promise<void>;
  stop: () => void;
};

export function collapse(floor: number, onLand: () => void): Collapse {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const found = [...document.querySelectorAll<HTMLElement>(PIECES)].filter(
    (el) => {
      const r = el.getBoundingClientRect();
      // hidden pieces (e.g. under the 504 card) must not pile up invisibly
      const seen = el.checkVisibility
        ? el.checkVisibility({
            opacityProperty: true,
            visibilityProperty: true,
          })
        : getComputedStyle(el).visibility !== "hidden";
      return (
        seen &&
        r.bottom > 0 &&
        r.top < vh &&
        r.width > 8 &&
        r.height > 8 &&
        r.width < vw * 0.95 &&
        r.height < vh * 0.8
      );
    },
  );
  // keep the smallest pieces: drop any element that contains another one
  const pieces = found
    .filter((el) => !found.some((other) => other !== el && el.contains(other)))
    .slice(0, 90);

  const now = performance.now();
  const bodies: Body[] = pieces.map((el) => {
    const r = el.getBoundingClientRect();
    const transition = el.style.transition;
    el.style.transition = "none";
    el.style.willChange = "transform";
    return {
      el,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: el.offsetWidth || r.width,
      h: el.offsetHeight || r.height,
      x: 0,
      y: 0,
      a: 0,
      vx: (Math.random() - 0.5) * 300,
      vy: -Math.random() * 380,
      va: (Math.random() - 0.5) * 7,
      start: now + Math.random() * 380 + (1 - r.top / vh) * 220,
      resting: false,
      transition,
    };
  });
  const heights = new Array(Math.ceil(vw / COLUMN) + 1).fill(floor);
  let order: number[] = []; // landing order: later ones lie on top
  let held: number | null = null;
  let frame = 0;
  let last = now;

  const extent = (b: Body) => {
    const s = Math.abs(Math.sin(b.a));
    const c = Math.abs(Math.cos(b.a));
    return { hw: (b.w * c + b.h * s) / 2, hh: (b.w * s + b.h * c) / 2 };
  };
  const span = (x0: number, x1: number) => {
    const from = Math.max(0, Math.floor(x0 / COLUMN));
    const to = Math.min(heights.length - 1, Math.ceil(x1 / COLUMN));
    return { from, to };
  };
  const paint = (b: Body) => {
    b.el.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.a}rad)`;
  };

  const step = (t: number) => {
    // fixed sub-steps keep real time even when frames are rare
    const elapsed = Math.min(0.12, (t - last) / 1000);
    last = t;
    const steps = Math.max(1, Math.ceil(elapsed / 0.008));
    let moving = false;
    for (let n = 0; n < steps; n++)
      moving = advance(t, elapsed / steps) || moving;
    for (const b of bodies) paint(b);
    if (moving || held !== null) frame = requestAnimationFrame(step);
    else frame = 0;
  };
  const advance = (t: number, dt: number) => {
    let moving = false;
    bodies.forEach((b, i) => {
      if (b.resting || i === held || t < b.start) {
        if (t < b.start) moving = true;
        return;
      }
      moving = true;
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += b.va * dt;
      const { hw, hh } = extent(b);
      const cx = b.cx + b.x;
      if (cx - hw < 0) b.vx = Math.abs(b.vx) * 0.5;
      if (cx + hw > vw) b.vx = -Math.abs(b.vx) * 0.5;
      const { from, to } = span(cx - hw, cx + hw);
      let ground = floor;
      for (let c = from; c <= to; c++) ground = Math.min(ground, heights[c]);
      const bottom = b.cy + b.y + hh;
      if (b.vy > 0 && bottom >= ground) {
        b.y -= bottom - ground;
        if (b.vy > 260) {
          b.vy = -b.vy * 0.3;
          b.vx *= 0.6;
          b.va *= 0.5;
          onLand();
        } else {
          // settle on the nearest flat side, then become part of the pile
          // long side down, like anything dropped on a table, a little askew
          const quarter = Math.PI / 2;
          const turns = Math.round(b.a / quarter);
          const upright = Math.abs(turns) % 2 === 1;
          const flatTurns = b.w >= b.h === upright ? turns + 1 : turns;
          b.a = flatTurns * quarter + (Math.random() - 0.5) * 0.12;
          const flat = extent(b);
          b.y = ground - flat.hh - b.cy;
          b.vx = b.vy = b.va = 0;
          b.resting = true;
          order = [...order.filter((n) => n !== i), i];
          const fx = span(b.cx + b.x - flat.hw, b.cx + b.x + flat.hw);
          for (let c = fx.from; c <= fx.to; c++)
            heights[c] = Math.min(heights[c], ground - flat.hh * 2);
        }
      }
    });
    return moving;
  };
  frame = requestAnimationFrame(step);
  const kick = () => {
    if (!frame) {
      last = performance.now();
      frame = requestAnimationFrame(step);
    }
  };

  let lastDrag = { x: 0, y: 0, t: 0, vx: 0, vy: 0 };
  return {
    grab(px, py) {
      for (const i of [...order].reverse()) {
        const r = bodies[i].el.getBoundingClientRect();
        if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
          held = i;
          bodies[i].resting = false;
          lastDrag = { x: px, y: py, t: performance.now(), vx: 0, vy: 0 };
          kick();
          return i;
        }
      }
      return null;
    },
    drag(i, px, py) {
      const b = bodies[i];
      const t = performance.now();
      const dt = Math.max(8, t - lastDrag.t) / 1000;
      lastDrag = {
        x: px,
        y: py,
        t,
        vx: (px - lastDrag.x) / dt,
        vy: (py - lastDrag.y) / dt,
      };
      b.x = px - b.cx;
      b.y = py - b.cy;
      b.a += lastDrag.vx * 0.00004;
      paint(b);
    },
    release(i) {
      const b = bodies[i];
      b.vx = Math.max(-2400, Math.min(2400, lastDrag.vx));
      b.vy = Math.max(-2400, Math.min(2400, lastDrag.vy));
      b.va = lastDrag.vx * 0.004;
      held = null;
      kick();
    },
    rewind(ms) {
      cancelAnimationFrame(frame);
      frame = 0;
      const from = bodies.map((b) => ({ x: b.x, y: b.y, a: b.a }));
      const t0 = performance.now();
      return new Promise((resolve) => {
        const back = (t: number) => {
          // VHS rewind: jerky steps with a little tracking jitter
          const k = Math.min(1, Math.floor(((t - t0) / ms) * 24) / 24);
          const e = 1 - (1 - k) ** 3;
          bodies.forEach((b, i) => {
            const jitter = k < 1 ? (Math.random() - 0.5) * 6 : 0;
            b.x = from[i].x * (1 - e) + jitter;
            b.y = from[i].y * (1 - e);
            b.a = from[i].a * (1 - e);
            paint(b);
          });
          if (k < 1) requestAnimationFrame(back);
          else {
            for (const b of bodies) {
              b.el.style.transform = "";
              b.el.style.willChange = "";
              b.el.style.transition = b.transition;
            }
            resolve();
          }
        };
        requestAnimationFrame(back);
      });
    },
    stop() {
      cancelAnimationFrame(frame);
      for (const b of bodies) {
        b.el.style.transform = "";
        b.el.style.willChange = "";
        b.el.style.transition = b.transition;
      }
    },
  };
}
