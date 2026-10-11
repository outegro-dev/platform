"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { StaticImageData } from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  type Group,
  type Mesh,
  PlaneGeometry,
  type Texture,
  TextureLoader,
} from "three";
import cloudSprite from "@/assets/paper/cloud.webp";
import houseSprite from "@/assets/paper/house.webp";
import pierSprite from "@/assets/paper/pier.webp";
import seagullSprite from "@/assets/paper/seagull.webp";
import shipSprite from "@/assets/paper/ship.webp";
import treeSprite from "@/assets/paper/tree.webp";
import busSprite from "@/assets/strip/bus.webp";
import carSprite from "@/assets/strip/car.webp";
import fishSprite from "@/assets/strip/fish.webp";
import pigeonSprite from "@/assets/strip/pigeon.webp";
import planeSprite from "@/assets/strip/plane.webp";
import subSprite from "@/assets/strip/sub.webp";
import truckSprite from "@/assets/strip/truck.webp";
import weedSprite from "@/assets/strip/weed.webp";
import {
  type Backdrop,
  STAGE_ORDER,
  STAGES,
  type Stage,
  type Vehicle,
} from "./stages";

/** Scroll state the bar writes and the scene reads every frame. */
export type Voyage = {
  /** 0 at the top of the page, 1 at the bottom. */
  progress: number;
  /** px per ms, signed; decays when scrolling stops. */
  velocity: number;
  /** The set for the section under the middle of the screen. */
  stage: Stage;
  /** The strip is on screen: sets change on stage, otherwise they cut. */
  shown: boolean;
  /** Set by the scene: call to request frames while something moves. */
  wake: () => void;
};

const SPRITES = {
  ship: shipSprite,
  plane: planeSprite,
  car: carSprite,
  sub: subSprite,
  bus: busSprite,
  truck: truckSprite,
  pigeon: pigeonSprite,
  pier: pierSprite,
  gull: seagullSprite,
  cloud: cloudSprite,
  tree: treeSprite,
  house: houseSprite,
  fish: fishSprite,
  weed: weedSprite,
} satisfies Record<string, StaticImageData>;
type Sprite = keyof typeof SPRITES;
const aspect = (name: Sprite) => SPRITES[name].width / SPRITES[name].height;

const SEGMENTS = 96;
const SURFACE = 34; // px above the bottom that the strips' bases count from
const PAPER_EDGE = "#fbf6e8";
const INK = "#1b1915";
const STEP_MS = 1000 / 12; // idle motion runs "on twos"
const CHANGE = 0.4; // s, one change of sets
const STRIP_HEIGHT = 112; // the desktop strip; smaller screens scale down

type Layer = {
  color: string;
  base: number;
  amp: number;
  k: number;
  speed: number;
  shift: number;
  /** Land and sky: does not get rough with fast scrolling. */
  calm?: boolean;
  /** Bumps instead of waves: a bank of clouds. */
  scallop?: boolean;
};

// Cut paper strips per backdrop, back to front; the white edge is the scissor margin.
const BACKDROPS: Record<Backdrop, Layer[]> = {
  // a band of blue sky behind a bank of clouds
  sky: [
    {
      color: "#8ec1ea",
      base: 16,
      amp: 3,
      k: 0.009,
      speed: 0.0005,
      shift: 0,
      calm: true,
    },
    {
      color: "#ffffff",
      base: -6,
      amp: 17,
      k: 0.03,
      speed: 0.0003,
      shift: 1,
      calm: true,
      scallop: true,
    },
  ],
  road: [
    // hills, then the asphalt
    { color: "#7cb36b", base: 14, amp: 8, k: 0.012, speed: 0, shift: 0 },
    { color: "#5e5a52", base: -6, amp: 0, k: 0, speed: 0, shift: 0 },
  ].map((layer) => ({ ...layer, calm: true })),
  sea: [
    { color: "#9cc4ea", base: 10, amp: 5, k: 0.011, speed: 0.0011, shift: 0 },
    { color: "#5b95d3", base: 0, amp: 6, k: 0.016, speed: -0.0016, shift: 2 },
    { color: "#2d63ae", base: -12, amp: 4, k: 0.022, speed: 0.0021, shift: 4 },
  ],
  deep: [
    // the lit skin of the surface, darker and darker water, then the sand
    { color: "#9cc4ea", base: 24, amp: 3, k: 0.016, speed: -0.0016, shift: 2 },
    { color: "#2d63ae", base: 18, amp: 3, k: 0.013, speed: 0.0013, shift: 1 },
    { color: "#1a3f7a", base: 2, amp: 3, k: 0.011, speed: -0.0009, shift: 0 },
    {
      color: "#d8bd84",
      base: -18,
      amp: 4,
      k: 0.035,
      speed: 0,
      shift: 1,
      calm: true,
    },
  ],
};
const KINDS = Object.keys(BACKDROPS) as Backdrop[];

type Scenery = {
  sprite: Sprite;
  /** Place across the strip, 0..1. */
  at: number;
  /** Root height above the bottom and height, px on the desktop strip. */
  y: number;
  h: number;
  z: number;
  /** px per second to the right, wrapping round. */
  drift?: number;
  bob?: number;
  sway?: boolean;
};

// Flats standing on each backdrop; they ride along when a set slides.
const SCENERY: Record<Backdrop, Scenery[]> = {
  sky: [
    { sprite: "cloud", at: 0.14, y: 54, h: 32, z: 0.02, drift: 5 },
    { sprite: "cloud", at: 0.5, y: 70, h: 26, z: 0.02, drift: 4 },
    { sprite: "cloud", at: 0.83, y: 50, h: 36, z: 0.02, drift: 6 },
  ],
  // planted behind the asphalt, which hides their roots
  road: [
    { sprite: "tree", at: 0.1, y: 24, h: 36, z: 0.07 },
    { sprite: "house", at: 0.36, y: 24, h: 30, z: 0.07 },
    { sprite: "tree", at: 0.64, y: 24, h: 30, z: 0.07 },
    { sprite: "tree", at: 0.9, y: 24, h: 38, z: 0.07 },
  ],
  sea: [],
  // between the deepest water and the sand
  deep: [
    { sprite: "weed", at: 0.07, y: 6, h: 44, z: 0.27, sway: true },
    { sprite: "weed", at: 0.33, y: 6, h: 52, z: 0.27, sway: true },
    { sprite: "weed", at: 0.71, y: 6, h: 40, z: 0.27, sway: true },
    { sprite: "weed", at: 0.94, y: 6, h: 48, z: 0.27, sway: true },
    { sprite: "fish", at: 0.2, y: 22, h: 20, z: 0.27, drift: 22, bob: 3 },
  ],
};

/** How tall each rider is: at most `max` px, a share of a smaller strip. */
const RIDERS: Record<Vehicle, { max: number; share: number }> = {
  plane: { max: 30, share: 0.27 },
  car: { max: 46, share: 0.42 },
  ship: { max: 74, share: 0.68 },
  sub: { max: 56, share: 0.5 },
  bus: { max: 52, share: 0.46 },
  truck: { max: 52, share: 0.46 },
  pigeon: { max: 50, share: 0.46 },
};
const VEHICLES = Object.keys(RIDERS) as Vehicle[];

/** A hop off the stage and back: up a little, then down past the bottom. */
const jump = (q: number) => q * (193 - 333 * q);

function useTextures() {
  const [textures, setTextures] = useState<Partial<Record<Sprite, Texture>>>(
    {},
  );
  useEffect(() => {
    const loader = new TextureLoader();
    const loaded: Texture[] = [];
    let alive = true;
    // each sprite shows up as soon as it lands; the set waits for nobody
    for (const name of Object.keys(SPRITES) as Sprite[]) {
      loader.load(SPRITES[name].src, (texture) => {
        if (!alive) {
          texture.dispose();
          return;
        }
        loaded.push(texture);
        setTextures((all) => ({ ...all, [name]: texture }));
      });
    }
    return () => {
      alive = false;
      for (const texture of loaded) texture.dispose();
    };
  }, []);
  return textures;
}

function paint(
  width: number,
  height: number,
  draw: (g: CanvasRenderingContext2D) => void,
) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  if (g) draw(g);
  return new CanvasTexture(c);
}

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** A white disc with an ink rim: one drop of a splash. */
const dropTexture = () =>
  paint(32, 32, (g) => {
    g.fillStyle = INK;
    disc(g, 16, 16, 15);
    g.fillStyle = "#ffffff";
    disc(g, 16, 16, 12);
  });

/** A pale ring with a glint: one bubble. */
const bubbleTexture = () =>
  paint(32, 32, (g) => {
    g.fillStyle = INK;
    disc(g, 16, 16, 15);
    g.fillStyle = "#cfe6f8";
    disc(g, 16, 16, 12);
    g.fillStyle = "#ffffff";
    disc(g, 11, 11, 4);
  });

/** The rolled-up edge of a backdrop: a paper tube with its curl on top. */
const rollTexture = () =>
  paint(32, 128, (g) => {
    g.fillStyle = INK;
    g.fillRect(0, 8, 32, 120);
    g.fillStyle = "#e3d3a8";
    g.fillRect(3, 8, 26, 117);
    g.fillStyle = PAPER_EDGE;
    g.fillRect(8, 8, 9, 117);
    g.fillStyle = INK;
    g.fillRect(21, 8, 2, 117);
    g.beginPath();
    g.ellipse(16, 8, 16, 7.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAPER_EDGE;
    g.beginPath();
    g.ellipse(16, 8, 13, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(17, 8, 6, 2.5, 0, 0, Math.PI * 1.6);
    g.stroke();
  });

function stripGeometry() {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3),
  );
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(index);
  return g;
}

/** The centre line of the road: an 18 px dash every 44 px. */
function dashGeometry(width: number) {
  const count = Math.ceil(width / 44) + 1;
  const position = new Float32Array(count * 12);
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + i * 44;
    position.set([x, 0, 0, x + 18, 0, 0, x, 3, 0, x + 18, 3, 0], i * 12);
    const a = i * 4;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(position, 3));
  g.setIndex(index);
  return g;
}

function waveY(layer: Layer, x: number, t: number, swell: number) {
  const amp = layer.calm ? layer.amp : layer.amp * swell;
  const phase = layer.k * x + t * layer.speed * 1000 + layer.shift;
  if (layer.scallop) return layer.base + amp * Math.abs(Math.sin(phase));
  return (
    layer.base +
    amp * Math.sin(phase) +
    amp * 0.4 * Math.sin(layer.k * 2.3 * x - t * layer.speed * 700)
  );
}

function Layers({
  layers,
  geometries,
}: {
  layers: Layer[];
  geometries: { strip: BufferGeometry; edge: BufferGeometry }[];
}) {
  return layers.map((layer, i) => (
    <group key={layer.color}>
      <mesh geometry={geometries[i].edge} position={[0, 0, i * 0.1]}>
        <meshBasicMaterial color={PAPER_EDGE} />
      </mesh>
      <mesh geometry={geometries[i].strip} position={[0, 0, i * 0.1 + 0.05]}>
        <meshBasicMaterial color={layer.color} />
      </mesh>
    </group>
  ));
}

function Flat({
  texture,
  geometry,
  onMesh,
  renderOrder,
}: {
  texture: Texture | undefined;
  geometry?: BufferGeometry;
  onMesh: (mesh: Mesh | null) => void;
  renderOrder?: number;
}) {
  if (!texture) return null;
  return (
    <mesh
      ref={onMesh}
      geometry={geometry}
      renderOrder={renderOrder}
      visible={false}
    >
      {!geometry && <planeGeometry />}
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function Strip({ voyage }: { voyage: Voyage }) {
  const { size, invalidate } = useThree();
  const sets = useRef<Partial<Record<Backdrop, Group | null>>>({});
  const scenery = useRef<Partial<Record<string, Mesh | null>>>({});
  const riders = useRef<Partial<Record<Vehicle, Mesh | null>>>({});
  const harbour = useRef<Group>(null);
  const pier = useRef<Mesh | null>(null);
  const gull = useRef<Mesh | null>(null);
  const roll = useRef<Mesh>(null);
  const drops = useRef<(Mesh | null)[]>([]);
  const bubbles = useRef<(Mesh | null)[]>([]);
  const textures = useTextures();
  const painted = useMemo(
    () => ({
      drop: dropTexture(),
      bubble: bubbleTexture(),
      roll: rollTexture(),
    }),
    [],
  );
  const geometries = useMemo(
    () =>
      Object.fromEntries(
        KINDS.map((kind) => [
          kind,
          BACKDROPS[kind].map(() => {
            const strip = stripGeometry();
            return { strip, edge: strip.clone() };
          }),
        ]),
      ) as Record<Backdrop, { strip: BufferGeometry; edge: BufferGeometry }[]>,
    [],
  );
  // flats stand on their root, so a sway bends them at the foot
  const footed = useMemo(
    () => new PlaneGeometry(1, 1).translate(0, 0.5, 0),
    [],
  );
  const dashes = useMemo(() => dashGeometry(size.width), [size.width]);
  useEffect(() => () => dashes.dispose(), [dashes]);
  const state = useRef({
    swell: 1,
    facing: 1,
    // the set on stage and the one coming in; equal when settled
    from: voyage.stage,
    to: voyage.stage,
    since: 0,
    dir: 1,
    nextShot: 0,
    nextBubble: 0,
    splash: [] as {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
    }[],
    fizz: [] as { x: number; y: number; born: number; rise: number }[],
  });

  // the scroll handler wakes the render loop; idle motion ticks on twos
  // while the strip is on screen
  useEffect(() => {
    voyage.wake = () => invalidate();
    const tick = window.setInterval(() => {
      if (voyage.shown) invalidate();
    }, STEP_MS);
    return () => clearInterval(tick);
  }, [voyage, invalidate]);

  useFrame(({ clock }) => {
    const s = state.current;
    const now = clock.elapsedTime;
    const moving = Math.abs(voyage.velocity) > 0.02;
    // stop-motion: hold each drawing for a twelfth of a second when calm
    const t = moving ? now : Math.floor(now * 12) / 12;
    const step = Math.floor(now * 12);
    const w = size.width;
    const half = w / 2;
    const bottom = -size.height / 2;
    const zoom = Math.min(1, size.height / STRIP_HEIGHT);
    const target = 1 + Math.min(2.6, Math.abs(voyage.velocity) * 1.6);
    s.swell += (target - s.swell) * 0.08;
    if (voyage.velocity > 0.05) s.facing = 1;
    else if (voyage.velocity < -0.05) s.facing = -1;

    // change of sets: one at a time, the latest wish wins; unseen, it cuts
    if (s.from !== s.to && now - s.since >= CHANGE) s.from = s.to;
    if (s.from === s.to && voyage.stage !== s.to) {
      if (voyage.shown) {
        s.to = voyage.stage;
        s.since = now;
        s.dir =
          STAGE_ORDER.indexOf(s.to) > STAGE_ORDER.indexOf(s.from) ? 1 : -1;
      } else {
        s.from = s.to = voyage.stage;
      }
    }
    const changing = s.from !== s.to;
    // the change is stepped on twos too: about five drawings
    const p = changing
      ? Math.min(1, Math.floor((now - s.since) * 12) / (CHANGE * 12))
      : 1;
    const old = STAGES[s.from];
    const next = STAGES[s.to];
    /** Where a flat stands: sliding out, sliding in, staying, or off. */
    const slide = (wasOn: boolean, isOn: boolean) => {
      if (wasOn && isOn) return 0;
      if (isOn) return s.dir * (1 - p) * w;
      if (wasOn) return -s.dir * p * w;
      return null;
    };

    for (const kind of KINDS) {
      const set = sets.current[kind];
      if (!set) continue;
      const x = slide(old.backdrop === kind, next.backdrop === kind);
      set.visible = x !== null;
      if (x === null) continue;
      set.position.x = x;
      BACKDROPS[kind].forEach((layer, li) => {
        const { strip, edge } = geometries[kind][li];
        const sp = strip.getAttribute("position") as BufferAttribute;
        const ep = edge.getAttribute("position") as BufferAttribute;
        for (let i = 0; i <= SEGMENTS; i++) {
          const lx = -half + (w * i) / SEGMENTS;
          const y = bottom + SURFACE + waveY(layer, lx, t, s.swell);
          sp.setXYZ(i * 2, lx, y, 0);
          sp.setXYZ(i * 2 + 1, lx, bottom, 0);
          ep.setXYZ(i * 2, lx, y + 3, 0);
          ep.setXYZ(i * 2 + 1, lx, bottom, 0);
        }
        sp.needsUpdate = true;
        ep.needsUpdate = true;
        strip.computeBoundingSphere();
        edge.computeBoundingSphere();
      });
      SCENERY[kind].forEach((item, i) => {
        const mesh = scenery.current[`${kind}${i}`];
        if (!mesh) return;
        const h = item.h * zoom;
        const width = h * aspect(item.sprite);
        const lane = w + width * 2;
        const x = item.drift
          ? ((item.at * lane + t * item.drift) % lane) - half - width
          : -half + item.at * w;
        const bob = item.bob ? Math.sin(t * 2 + i) * item.bob : 0;
        mesh.visible = true;
        mesh.scale.set(width, h, 1);
        mesh.position.set(x, bottom + item.y * zoom + bob, item.z);
        mesh.rotation.z = item.sway ? Math.sin(t * 1.6 + i * 1.7) * 0.12 : 0;
      });
    }

    // the rolled edge of the incoming backdrop, at the seam between the two
    if (roll.current) {
      const seam = s.dir > 0 ? -half + (1 - p) * w : half - (1 - p) * w;
      const h = 76 * zoom;
      roll.current.visible =
        changing && old.backdrop !== next.backdrop && p > 0 && p < 1;
      roll.current.scale.set(18, h, 1);
      // in front of every strip, behind the riders
      roll.current.position.set(seam, bottom + h / 2, 0.38);
    }

    // the pier stands at the end of the issue, with a gull on it
    const dock = slide(s.from === "pier", s.to === "pier");
    const ph = Math.min(70, size.height * 0.64);
    if (harbour.current) {
      harbour.current.visible = dock !== null;
      harbour.current.position.x = dock ?? 0;
    }
    if (pier.current) {
      pier.current.visible = true;
      pier.current.scale.set(ph * aspect("pier"), ph, 1);
      pier.current.position.set(half - ph * 0.7, bottom + ph * 0.55, 0.12);
    }
    if (gull.current) {
      const gh = ph * 0.55;
      const hop = Math.abs(Math.sin(Math.floor(now * 4))) * 4;
      gull.current.visible = true;
      gull.current.scale.set(gh * aspect("gull"), gh, 1);
      gull.current.position.set(
        half - ph * 0.42,
        bottom + ph * 0.98 + gh * 0.4 + hop,
        0.13,
      );
    }

    // the rider's x is how far down the page you are
    const margin = Math.min(90, w * 0.12);
    const sx = -half + margin + voyage.progress * (w - margin * 2.6);
    const sea = BACKDROPS.sea[1];
    const deepSurface = SURFACE + BACKDROPS.deep[0].base;
    let subY = 0;
    let subW = 0;
    for (const v of VEHICLES) {
      const mesh = riders.current[v];
      if (!mesh) continue;
      const leaving = old.vehicle === v && next.vehicle !== v;
      const coming = next.vehicle === v && old.vehicle !== v;
      mesh.visible = leaving || coming || next.vehicle === v;
      if (!mesh.visible) continue;
      const h = Math.min(RIDERS[v].max, size.height * RIDERS[v].share);
      let y = bottom;
      let tilt = 0;
      let squash = 1;
      switch (v) {
        case "ship": {
          const slope =
            (waveY(sea, sx + 6, t, s.swell) - waveY(sea, sx - 6, t, s.swell)) /
            12;
          y += SURFACE + waveY(sea, sx, t, s.swell) + h * 0.34;
          tilt = Math.atan(slope) * 0.9 + Math.sin(t * 2.1) * 0.04;
          break;
        }
        case "sub":
          // the hull under the surface, the periscope above it
          y += deepSurface - h * 0.34 + Math.sin(t * 1.3) * 2;
          tilt = Math.sin(t * 0.9) * 0.03;
          subY = y;
          subW = h * aspect("sub");
          break;
        case "plane":
          y += 70 * zoom + Math.sin(t * 1.7) * 4;
          tilt = Math.sin(t * 1.1) * 0.05;
          break;
        case "pigeon":
          y += 64 * zoom + Math.sin(t * 2.4) * 3;
          squash = step % 2 ? 0.9 : 1; // wings up, wings down
          break;
        default: {
          // on the road: wheels in the near lane, a bump on every other step
          const bump = moving && step % 2 ? 1 : 0;
          y += 10 * zoom + h / 2 + bump * 1.5;
          tilt = bump * 0.02 * s.facing;
        }
      }
      // the old rider hops off in the first half, the new one on in the second
      if (leaving) {
        const q = Math.min(1, p / 0.5);
        y += jump(q);
        tilt -= s.facing * q * 0.6;
      } else if (coming) {
        const q = Math.max(0, (p - 0.5) / 0.5);
        y += jump(1 - q);
        tilt += s.facing * (1 - q) * 0.3;
      }
      mesh.scale.set(h * aspect(v) * s.facing, h * squash, 1);
      mesh.position.set(sx, y, v === "ship" ? 0.17 : 0.4);
      mesh.rotation.z = tilt;
    }

    // cannonballs over the Battleship report
    const settled = changing ? null : s.to;
    if (settled === "battle" && now > s.nextShot) {
      s.nextShot = now + 0.7 + Math.random() * 1.1;
      const x = sx + (Math.random() - 0.5) * 360;
      for (let i = 0; i < 7; i++)
        s.splash.push({
          x,
          y: bottom + 40,
          vx: (Math.random() - 0.5) * 120,
          vy: 160 + Math.random() * 140,
          life: 1,
        });
    }
    const dt = 1 / 60;
    s.splash = s.splash.filter((d) => d.life > 0);
    drops.current.forEach((mesh, i) => {
      if (!mesh) return;
      const d = s.splash[i];
      mesh.visible = Boolean(d);
      if (!d) return;
      d.vy -= 520 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt * 0.9;
      if (d.y < bottom + 20) d.life = 0;
      const r = 5 + d.life * 6;
      mesh.scale.set(r, r, 1);
      mesh.position.set(d.x, d.y, 2);
    });

    // bubbles from the submarine's screw, popping at the surface; they rise
    // on the stepped clock, so they need no frames of their own
    if (settled === "platform" && subW && now > s.nextBubble) {
      s.nextBubble = now + 0.35 + Math.random() * 0.5;
      s.fizz.push({
        x: sx - s.facing * subW * 0.42,
        y: subY,
        born: t,
        rise: 24 + Math.random() * 16,
      });
    }
    s.fizz = s.fizz.filter(
      (b) => b.y + (t - b.born) * b.rise < bottom + deepSurface,
    );
    bubbles.current.forEach((mesh, i) => {
      if (!mesh) return;
      const b = s.fizz[i];
      mesh.visible = Boolean(b);
      if (!b) return;
      const age = t - b.born;
      const r = 7 + Math.min(4, age * 5);
      mesh.scale.set(r, r, 1);
      mesh.position.set(b.x + Math.sin(age * 6) * 2, b.y + age * b.rise, 0.45);
    });

    voyage.velocity *= 0.9;
    if (moving || changing || s.splash.length || Math.abs(s.swell - 1) > 0.02)
      invalidate();
  });

  return (
    <>
      {KINDS.map((kind) => (
        <group
          key={kind}
          ref={(g) => {
            sets.current[kind] = g;
          }}
          visible={false}
        >
          <Layers layers={BACKDROPS[kind]} geometries={geometries[kind]} />
          {SCENERY[kind].map((item, i) => (
            <Flat
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of flats.
              key={i}
              texture={textures[item.sprite]}
              geometry={footed}
              onMesh={(m) => {
                scenery.current[`${kind}${i}`] = m;
              }}
            />
          ))}
          {kind === "road" && (
            <mesh geometry={dashes} position={[0, -size.height / 2 + 13, 0.16]}>
              <meshBasicMaterial color={PAPER_EDGE} />
            </mesh>
          )}
          {kind === "deep" &&
            Array.from({ length: 6 }, (_, i) => (
              <mesh
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool of identical bubbles.
                key={i}
                ref={(m) => {
                  bubbles.current[i] = m;
                }}
                visible={false}
              >
                <planeGeometry />
                <meshBasicMaterial
                  map={painted.bubble}
                  transparent
                  depthWrite={false}
                />
              </mesh>
            ))}
        </group>
      ))}
      <group ref={harbour} visible={false}>
        {/* between the back and middle strips of the sea */}
        <Flat
          texture={textures.pier}
          onMesh={(m) => {
            pier.current = m;
          }}
        />
        <Flat
          texture={textures.gull}
          onMesh={(m) => {
            gull.current = m;
          }}
        />
      </group>
      <mesh ref={roll} visible={false}>
        <planeGeometry />
        <meshBasicMaterial map={painted.roll} transparent depthWrite={false} />
      </mesh>
      {VEHICLES.map((v) => (
        <Flat
          key={v}
          texture={textures[v]}
          onMesh={(m) => {
            riders.current[v] = m;
          }}
          // the ship sits between the middle and front strips, so its bow
          // dips into the sea
          renderOrder={v === "ship" ? 1 : 0}
        />
      ))}
      {Array.from({ length: 28 }, (_, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool of identical drops.
          key={i}
          ref={(m) => {
            drops.current[i] = m;
          }}
          visible={false}
        >
          <planeGeometry />
          <meshBasicMaterial
            map={painted.drop}
            transparent
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

export default function BoatCanvas({
  voyage,
  onLost,
}: {
  voyage: Voyage;
  onLost: () => void;
}) {
  return (
    <Canvas
      orthographic
      // no tone mapping: flat paper colours, as printed
      flat
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", onLost, {
          once: true,
        });
      }}
    >
      <Strip voyage={voyage} />
    </Canvas>
  );
}
