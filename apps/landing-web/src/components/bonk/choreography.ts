import { batTip, FIGURE_H, FOOT_X, GROUND, type Pose, restPose } from "./sahur";

/*
 * When Tung Tung Tung Sahur does what, and where he stands: pure functions of
 * time (ms from the click on the retry button) and the page geometry, shared
 * by the live actor and the storyboard at /design-system/sahur.
 */

export const KNOCKS = [0, 240, 480];
export const DOOR_OPEN = 720;
const EMERGE = [900, 1700] as const;
export const WINDUP = [1850, 2250] as const;
export const SWING = [2250, 2370] as const;
export const HIT_STOP = 2470;
const FOLLOW = [2470, 2640] as const;
const RELAX = [2640, 2980] as const;
const TURN = 2980;
export const LEAVE = 3040;
/** Cut-out animation runs "on twos": poses change 15 times a second. */
export const FRAME_MS = 1000 / 15;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const seg = (t: number, [a, b]: readonly [number, number]) =>
  clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeInOut = (k: number) =>
  k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
const easeIn = (k: number) => k * k * k;

const carry = { hand: [10, 6] as [number, number], bat: -1.25 };
const windup = { hand: [-10, -56] as [number, number], bat: -1.0 };
const impact = { hand: [50, -2] as [number, number], bat: 1.62 };
const follow = { hand: [36, 36] as [number, number], bat: 2.55 };

function mix(
  a: { hand: [number, number]; bat: number },
  b: { hand: [number, number]; bat: number },
  k: number,
) {
  return {
    hand: [lerp(a.hand[0], b.hand[0], k), lerp(a.hand[1], b.hand[1], k)] as [
      number,
      number,
    ],
    bat: lerp(a.bat, b.bat, k),
  };
}

export type Stage = {
  /** CSS pixels per puppet unit once he is out of the door. */
  scale: number;
  doorScale: number;
  from: { x: number; y: number };
  stand: { x: number; y: number };
  /** Where the bat lands, page coordinates. */
  hit: { x: number; y: number };
};

/** Page coordinates of a viewport rect. */
const onPage = (r: DOMRect) => ({
  left: r.left + window.scrollX,
  top: r.top + window.scrollY,
  width: r.width,
  height: r.height,
});

export function planStage(card: HTMLElement, door: HTMLElement): Stage {
  const c = onPage(card.getBoundingClientRect());
  const d = onPage(door.getBoundingClientRect());
  const fit = (window.innerHeight * 0.46) / FIGURE_H;
  const scale = Math.max(0.75, Math.min(1.9, fit));
  const impactPose: Pose = { ...restPose, ...impact };
  const [tipX, tipY] = batTip(impactPose);
  const hit = {
    x: c.left + Math.min(90, c.width * 0.2),
    y: c.top + c.height / 2,
  };
  // feet so that the bat tip lands on the card, but always fully on screen
  const viewBottom = window.scrollY + window.innerHeight - 10;
  const y = Math.min(hit.y + (GROUND - tipY) * scale, viewBottom);
  const x = Math.max(
    window.scrollX + 10 + 60 * scale,
    hit.x - (tipX - FOOT_X) * scale,
  );
  return {
    scale,
    doorScale: (d.height * 1.05) / FIGURE_H,
    from: { x: d.left + d.width / 2, y: d.top + d.height },
    stand: { x, y: Math.max(y, d.top + d.height) },
    hit: { x: x + (tipX - FOOT_X) * scale, y: y - (GROUND - tipY) * scale },
  };
}

export type Frame = {
  pose: Pose;
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  visible: boolean;
};

export function frameAt(t: number, stage: Stage, leaveSpeed: number): Frame {
  const pose: Pose = { ...restPose, ...carry };
  let { x, y } = stage.from;
  let scale = stage.doorScale;
  let facing: 1 | -1 = stage.stand.x < stage.from.x ? -1 : 1;

  if (t < EMERGE[0]) return { pose, x, y, scale, facing, visible: false };

  // out of the door and towards the viewer: walking while growing
  const e = seg(t, EMERGE);
  const k = easeOut(e);
  x = lerp(stage.from.x, stage.stand.x, k);
  y = lerp(stage.from.y, stage.stand.y, k);
  scale = lerp(stage.doorScale, stage.scale, easeOut(Math.min(1, e * 1.4)));
  pose.stride = e < 1 ? 1 : 0;
  pose.phase = (t - EMERGE[0]) / 70;

  if (t >= EMERGE[1]) {
    facing = 1;
    scale = stage.scale;
    const w = seg(t, WINDUP);
    if (t < SWING[0]) {
      Object.assign(pose, mix(carry, windup, easeInOut(w)));
      pose.twoHands = w > 0.25;
      pose.batBehind = true;
      pose.face = w > 0.2 ? "angry" : "calm";
      pose.squash = easeIn(w);
    } else if (t < HIT_STOP) {
      const s = seg(t, SWING);
      Object.assign(pose, mix(windup, impact, easeIn(s)));
      pose.twoHands = true;
      pose.batBehind = false;
      pose.face = "angry";
      pose.squash = 1 - s;
      pose.smearFrom = s > 0 ? windup.bat : null;
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
      // job done: bat on the shoulder, off to the left
      facing = -1;
      const walked = Math.max(0, t - LEAVE) * leaveSpeed;
      x = stage.stand.x - walked;
      pose.stride = t >= LEAVE ? 1 : 0;
      pose.phase = (t - LEAVE) / 80;
    }
  }
  return { pose, x, y, scale, facing, visible: true };
}
