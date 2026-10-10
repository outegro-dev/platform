/*
 * Tung Tung Tung Sahur as a cut-out puppet, Monty Python style: the log (two
 * faces), the bat, a wooden stick, a fist with a hole for the bat and a foot
 * are realistic renders; this file pins them together at joints, so every
 * pose of the choreography comes from a few numbers.
 *
 * Coordinates are puppet units (the log is 200 tall), facing right; the
 * actor scales the canvas to the screen and mirrors it to face left.
 */

export const ART_W = 540;
export const ART_H = 392;
export const FOOT_X = 186;
export const GROUND = 376;

const BODY_H = 200;
const THIGH = 38;
const SHIN = 38;
const UPPER_ARM = 36;
const FOREARM = 36;
const LIMB_W = 12;
const FIST = 36;
const FOOT_W = 44;
const BAT_L = 178;
const GRIP = 16; // the fist holds the bat this far from the knob
const ANKLE = 10;
// where the bat goes through the fist image (measured on fist.webp)
const HOLE_X = 0.606;
const HOLE_Y = 0.567;

const HIP_Y = GROUND - ANKLE - (THIGH + SHIN) + 4;
const BODY_TOP = HIP_Y - BODY_H + 8;
/** Feet to the top of the log. */
export const FIGURE_H = GROUND - BODY_TOP;

export type Sprites = {
  calm: HTMLImageElement;
  angry: HTMLImageElement;
  bat: HTMLImageElement;
  stick: HTMLImageElement;
  fist: HTMLImageElement;
  foot: HTMLImageElement;
};

export type Pose = {
  /** Walk cycle phase in radians; 0 stride stands still. */
  phase: number;
  stride: number;
  /** Bat fist relative to the front shoulder (+x = facing). */
  hand: [number, number];
  /** Bat angle in radians: 0 points up, positive tips it forward. */
  bat: number;
  /** The bat rests over the shoulder, behind the log. */
  batBehind: boolean;
  /** The back fist joins the grip (wind-up and swing). */
  twoHands: boolean;
  face: "calm" | "angry";
  /** 0..1 anticipation squash of the log. */
  squash: number;
  /** Bat angle the swing smear starts from, or null for no smear. */
  smearFrom: number | null;
};

export const restPose: Pose = {
  phase: 0,
  stride: 0,
  hand: [10, 6],
  bat: -1.25,
  batBehind: true,
  twoHands: false,
  face: "calm",
  squash: 0,
  smearFrom: null,
};

type Point = readonly [number, number];

export function loadSprites(src: Record<keyof Sprites, string>) {
  const one = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  const keys = Object.keys(src) as (keyof Sprites)[];
  return Promise.all(keys.map((key) => one(src[key]))).then(
    (images) =>
      Object.fromEntries(keys.map((key, i) => [key, images[i]])) as Sprites,
  );
}

function shoulders(bob: number) {
  const y = BODY_TOP + 112 - bob;
  return { front: [FOOT_X + 22, y] as Point, back: [FOOT_X - 20, y] as Point };
}

function handPoint(pose: Pose, bob: number): Point {
  const [sx, sy] = shoulders(bob).front;
  return [sx + pose.hand[0], sy + pose.hand[1]];
}

/** Where the bat's barrel ends for a pose, in puppet units. */
export function batTip(pose: Pose): Point {
  const [hx, hy] = handPoint(pose, 0);
  const reach = BAT_L - GRIP - 12;
  return [hx + Math.sin(pose.bat) * reach, hy - Math.cos(pose.bat) * reach];
}

/** Two-segment joint: the middle point bends to the chosen side. */
function joint(
  a: Point,
  b: Point,
  l1: number,
  l2: number,
  pick: (p: Point, q: Point) => boolean,
): { mid: Point; end: Point } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
  const base = Math.atan2(dy, dx);
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d || 1);
  const bend = Math.acos(Math.max(-1, Math.min(1, cos)));
  const m1: Point = [
    a[0] + Math.cos(base + bend) * l1,
    a[1] + Math.sin(base + bend) * l1,
  ];
  const m2: Point = [
    a[0] + Math.cos(base - bend) * l1,
    a[1] + Math.sin(base - bend) * l1,
  ];
  return {
    mid: pick(m1, m2) ? m1 : m2,
    end: [a[0] + Math.cos(base) * d, a[1] + Math.sin(base) * d],
  };
}

function stick(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  a: Point,
  b: Point,
) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + LIMB_W * 0.6;
  ctx.save();
  ctx.translate(a[0], a[1]);
  ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2);
  ctx.drawImage(img, -LIMB_W / 2, -LIMB_W * 0.3, LIMB_W, len);
  ctx.restore();
}

function fist(
  ctx: CanvasRenderingContext2D,
  s: Sprites,
  at: Point,
  angle: number,
) {
  ctx.save();
  ctx.translate(at[0], at[1]);
  ctx.rotate(angle);
  ctx.drawImage(s.fist, -HOLE_X * FIST, -HOLE_Y * FIST, FIST, FIST);
  ctx.restore();
}

function arm(
  ctx: CanvasRenderingContext2D,
  s: Sprites,
  shoulder: Point,
  target: Point,
) {
  // elbows hang below the line from shoulder to fist
  const { mid, end } = joint(
    shoulder,
    target,
    UPPER_ARM,
    FOREARM,
    (p, q) => p[1] >= q[1],
  );
  stick(ctx, s.stick, shoulder, mid);
  stick(ctx, s.stick, mid, end);
  return end;
}

function leg(
  ctx: CanvasRenderingContext2D,
  s: Sprites,
  hip: Point,
  ankle: Point,
) {
  // knees point forward
  const { mid, end } = joint(hip, ankle, THIGH, SHIN, (p, q) => p[0] >= q[0]);
  stick(ctx, s.stick, hip, mid);
  stick(ctx, s.stick, mid, end);
  const h = (FOOT_W * s.foot.height) / s.foot.width;
  ctx.drawImage(s.foot, end[0] - FOOT_W * 0.3, end[1] - h * 0.35, FOOT_W, h);
}

function bat(
  ctx: CanvasRenderingContext2D,
  s: Sprites,
  at: Point,
  angle: number,
) {
  const w = (BAT_L * s.bat.width) / s.bat.height;
  ctx.save();
  ctx.translate(at[0], at[1]);
  ctx.rotate(angle);
  ctx.drawImage(s.bat, -w / 2, -(BAT_L - GRIP), w, BAT_L);
  ctx.restore();
}

function smear(
  ctx: CanvasRenderingContext2D,
  at: Point,
  from: number,
  to: number,
) {
  const a0 = Math.min(from, to) - Math.PI / 2;
  const a1 = Math.max(from, to) - Math.PI / 2;
  const glow = ctx.createRadialGradient(at[0], at[1], 40, at[0], at[1], BAT_L);
  glow.addColorStop(0, "rgba(255, 248, 228, 0)");
  glow.addColorStop(1, "rgba(255, 248, 228, 0.8)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(at[0], at[1], BAT_L - GRIP, a0, a1);
  ctx.arc(at[0], at[1], 60, a1, a0, true);
  ctx.closePath();
  ctx.fill();
}

/** Draw one frame of the puppet, facing right; mirror the canvas to face left. */
export function drawSahur(
  ctx: CanvasRenderingContext2D,
  s: Sprites,
  pose: Pose,
) {
  ctx.clearRect(0, 0, ART_W, ART_H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const bob = pose.stride > 0 ? Math.abs(Math.sin(pose.phase)) * 5 : 0;
  const hipY = HIP_Y - bob;

  // contact shadow on the paper
  ctx.fillStyle = "rgba(27, 25, 21, 0.18)";
  ctx.beginPath();
  ctx.ellipse(FOOT_X, GROUND - 2, 58, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  const ankles = [0, Math.PI].map((offset): Point => {
    const p = pose.phase + offset;
    return [
      FOOT_X + (offset ? -12 : 10) + Math.sin(p) * 20 * pose.stride,
      GROUND - ANKLE - Math.max(0, Math.cos(p)) * 12 * pose.stride,
    ];
  });
  const { front, back } = shoulders(bob);
  const hand = handPoint(pose, bob);
  const backTarget: Point = pose.twoHands
    ? [hand[0] - Math.sin(pose.bat) * 18, hand[1] + Math.cos(pose.bat) * 18]
    : [
        back[0] - 6 - Math.sin(pose.phase) * 16 * pose.stride,
        back[1] + 58 - Math.abs(Math.cos(pose.phase)) * 6 * pose.stride,
      ];

  // back to front
  leg(ctx, s, [FOOT_X - 12, hipY], ankles[1]);
  const backFist = arm(ctx, s, back, backTarget);
  if (!pose.twoHands) fist(ctx, s, backFist, 0.3);
  if (pose.batBehind) bat(ctx, s, hand, pose.bat);

  const log = pose.face === "angry" ? s.angry : s.calm;
  const h = BODY_H * (1 - pose.squash * 0.1);
  const w = ((BODY_H * log.width) / log.height) * (1 + pose.squash * 0.08);
  ctx.drawImage(log, FOOT_X - w / 2, hipY + 8 - h, w, h);

  leg(ctx, s, [FOOT_X + 10, hipY], ankles[0]);
  if (pose.smearFrom !== null) smear(ctx, hand, pose.smearFrom, pose.bat);
  if (!pose.batBehind) bat(ctx, s, hand, pose.bat);
  if (pose.twoHands) fist(ctx, s, backFist, pose.bat);
  const frontFist = arm(ctx, s, front, hand);
  fist(ctx, s, frontFist, pose.bat);
}
