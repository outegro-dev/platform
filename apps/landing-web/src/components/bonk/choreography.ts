import { batTip, FIGURE_H, FOOT_X, GROUND, type Pose, restPose } from "./sahur";

/*
 * Tung Tung Tung Sahur's cameo: he walks in from the edge of the screen,
 * bonks a crooked screenshot frame straight and walks back off with the bat
 * on his shoulder, three seconds in all. Pure functions of time (ms from
 * his first step) and the page geometry, shared by the live actor
 * (SahurCameo) and the storyboard at /design-system/sahur.
 */

const WALK_IN = [0, 1000] as const;
export const WINDUP = [1000, 1320] as const;
export const SWING = [1320, 1420] as const;
export const HIT_STOP = 1500;
const FOLLOW = [1500, 1640] as const;
const RELAX = [1640, 1940] as const;
const TURN = 1940;
const WALK_OFF = [2000, 3000] as const;
/** When he is off the screen again. */
export const DONE = WALK_OFF[1];
/** Cut-out animation runs "on twos": poses change 15 times a second. */
export const FRAME_MS = 1000 / 15;

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
const seg = (t: number, [a, b]: readonly [number, number]) =>
  clamp((t - a) / (b - a), 0, 1);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeInOut = (k: number) =>
  k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
const easeIn = (k: number) => k * k * k;

type Arm = { hand: [number, number]; bat: number };
const carry: Arm = { hand: [10, 6], bat: -1.25 };
const windup: Arm = { hand: [-10, -56], bat: -1.0 };
const impact: Arm = { hand: [50, -2], bat: 1.62 };
const follow: Arm = { hand: [36, 36], bat: 2.55 };

function mix(a: Arm, b: Arm, k: number): Arm {
  return {
    hand: [lerp(a.hand[0], b.hand[0], k), lerp(a.hand[1], b.hand[1], k)],
    bat: lerp(a.bat, b.bat, k),
  };
}

export type Stage = {
  /** CSS pixels per puppet unit. */
  scale: number;
  /** 1: he comes in from the left, facing right; -1 from the right. */
  facing: 1 | -1;
  /** Where his feet are off the screen, page coordinates. */
  from: { x: number; y: number };
  /** Where he stands to swing. */
  stand: { x: number; y: number };
  /** Where the bat lands. */
  hit: { x: number; y: number };
};

export type Frame = {
  pose: Pose;
  x: number;
  y: number;
  facing: 1 | -1;
  visible: boolean;
};

/** Half his width with the bat on his shoulder, in puppet units. */
const HALF = 110;

/**
 * Where he plays, for a frame on the screen now: he comes in from the edge
 * of the screen nearer the frame, so he never crosses the text beside it,
 * and lands the bat on its near edge, a third of the way down, standing
 * wholly on the screen; where the frame comes close to the edge (a phone)
 * he stands over its corner and the bat lands on the picture.
 */
export function planStage(target: HTMLElement): Stage {
  const box = target.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const scale = clamp((height * 0.3) / FIGURE_H, 0.5, 0.95);
  const [tipX, tipY] = batTip({ ...restPose, ...impact });
  const reach = (tipX - FOOT_X) * scale;
  const lift = (GROUND - tipY) * scale;
  const facing: 1 | -1 = box.left + box.right > width ? -1 : 1;
  const edge = facing === 1 ? box.left + 8 : box.right - 8;
  const room = HALF * 0.6 * scale;
  const x = clamp(edge - facing * reach, room, width - room);
  const y = Math.min(box.top + box.height * 0.34 + lift, height - 12);
  const sx = window.scrollX;
  const sy = window.scrollY;
  const off = facing === 1 ? -HALF * scale : width + HALF * scale;
  return {
    scale,
    facing,
    from: { x: off + sx, y: y + sy },
    stand: { x: x + sx, y: y + sy },
    hit: { x: x + facing * reach + sx, y: y - lift + sy },
  };
}

export function frameAt(t: number, stage: Stage): Frame {
  const pose: Pose = { ...restPose, ...carry };
  let x = stage.stand.x;
  const y = stage.stand.y;
  let facing = stage.facing;

  if (t < WALK_IN[1]) {
    // in from the edge, the bat on his shoulder
    x = lerp(stage.from.x, stage.stand.x, easeOut(seg(t, WALK_IN)));
    pose.stride = 1;
    pose.phase = t / 70;
  } else if (t < SWING[0]) {
    const w = seg(t, WINDUP);
    Object.assign(pose, mix(carry, windup, easeInOut(w)));
    pose.twoHands = w > 0.25;
    pose.face = w > 0.2 ? "angry" : "calm";
    pose.squash = easeIn(w);
  } else if (t < HIT_STOP) {
    const s = seg(t, SWING);
    Object.assign(pose, mix(windup, impact, easeIn(s)));
    pose.twoHands = true;
    pose.batBehind = false;
    pose.face = "angry";
    pose.squash = 1 - s;
    pose.smearFrom = s > 0 && s < 1 ? windup.bat : null;
  } else if (t < FOLLOW[1]) {
    Object.assign(pose, mix(impact, follow, easeOut(seg(t, FOLLOW))));
    pose.twoHands = true;
    pose.batBehind = false;
    pose.face = "angry";
  } else if (t < TURN) {
    const r = seg(t, RELAX);
    Object.assign(pose, mix(follow, carry, easeInOut(r)));
    pose.batBehind = r > 0.6;
    pose.face = r > 0.3 ? "calm" : "angry";
  } else {
    // job done: back the way he came, the bat on his shoulder
    facing = stage.facing === 1 ? -1 : 1;
    x = lerp(stage.stand.x, stage.from.x, easeIn(seg(t, WALK_OFF)));
    pose.stride = t >= WALK_OFF[0] ? 1 : 0;
    pose.phase = (t - WALK_OFF[0]) / 70;
  }
  return { pose, x, y, facing, visible: t < DONE };
}
