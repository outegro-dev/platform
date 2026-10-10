"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  type Mesh,
  type Texture,
  TextureLoader,
} from "three";
import pierSprite from "@/assets/paper/pier.webp";
import seagullSprite from "@/assets/paper/seagull.webp";
import shipSprite from "@/assets/paper/ship.webp";

/** Scroll state the bar writes and the scene reads every frame. */
export type Voyage = {
  /** 0 at the top of the page, 1 at the bottom. */
  progress: number;
  /** px per ms, signed; decays when scrolling stops. */
  velocity: number;
  /** The Battleship report is on screen: cannonballs fly. */
  battle: boolean;
  /** Set by the scene: call to request frames while something moves. */
  wake: () => void;
};

const SEGMENTS = 96;
// Cut paper strips, back to front; the white edge is the scissor margin.
const LAYERS = [
  { color: "#9cc4ea", base: 10, amp: 5, k: 0.011, speed: 0.0011, shift: 0 },
  { color: "#5b95d3", base: 0, amp: 6, k: 0.016, speed: -0.0016, shift: 2 },
  { color: "#2d63ae", base: -12, amp: 4, k: 0.022, speed: 0.0021, shift: 4 },
];
const PAPER_EDGE = "#fbf6e8";
const STEP_MS = 1000 / 12; // idle bobbing runs "on twos"

function useTextures() {
  const [textures, setTextures] = useState<Record<string, Texture> | null>(
    null,
  );
  useEffect(() => {
    const loader = new TextureLoader();
    const load = (src: string) =>
      new Promise<Texture>((resolve, reject) =>
        loader.load(src, resolve, undefined, reject),
      );
    let alive = true;
    Promise.all([
      load(shipSprite.src),
      load(pierSprite.src),
      load(seagullSprite.src),
    ]).then(([ship, pier, seagull]) => {
      if (alive) setTextures({ ship, pier, seagull });
    });
    return () => {
      alive = false;
    };
  }, []);
  return textures;
}

/** A white disc with an ink rim: one drop of a splash. */
function dropTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#1b1915";
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(16, 16, 12, 0, Math.PI * 2);
    g.fill();
  }
  return new CanvasTexture(c);
}

function waveY(
  layer: (typeof LAYERS)[number],
  x: number,
  t: number,
  swell: number,
) {
  return (
    layer.base +
    layer.amp *
      swell *
      Math.sin(layer.k * x + t * layer.speed * 1000 + layer.shift) +
    layer.amp *
      0.4 *
      swell *
      Math.sin(layer.k * 2.3 * x - t * layer.speed * 700)
  );
}

function Sea({ voyage }: { voyage: Voyage }) {
  const { size, invalidate } = useThree();
  const strips = useRef<(Mesh | null)[]>([]);
  const edges = useRef<(Mesh | null)[]>([]);
  const ship = useRef<Mesh>(null);
  const pier = useRef<Mesh>(null);
  const gull = useRef<Mesh>(null);
  const drops = useRef<(Mesh | null)[]>([]);
  const textures = useTextures();
  const drop = useMemo(() => dropTexture(), []);
  const geometries = useMemo(
    () =>
      LAYERS.map(() => {
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
        return { strip: g, edge: g.clone() };
      }),
    [],
  );
  const state = useRef({
    swell: 1,
    facing: 1,
    nextShot: 0,
    splash: [] as {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
    }[],
  });

  // the scroll handler wakes the render loop; idle bobbing ticks on twos
  useEffect(() => {
    voyage.wake = () => invalidate();
    const tick = window.setInterval(() => invalidate(), STEP_MS);
    return () => clearInterval(tick);
  }, [voyage, invalidate]);

  useFrame(({ clock }) => {
    const s = state.current;
    const moving = Math.abs(voyage.velocity) > 0.02;
    // stop-motion: hold each drawing for a twelfth of a second when calm
    const t = moving
      ? clock.elapsedTime
      : Math.floor(clock.elapsedTime * 12) / 12;
    const w = size.width;
    const half = w / 2;
    const bottom = -size.height / 2;
    const target = 1 + Math.min(2.6, Math.abs(voyage.velocity) * 1.6);
    s.swell += (target - s.swell) * 0.08;

    LAYERS.forEach((layer, li) => {
      const { strip, edge } = geometries[li];
      const sp = strip.getAttribute("position") as BufferAttribute;
      const ep = edge.getAttribute("position") as BufferAttribute;
      for (let i = 0; i <= SEGMENTS; i++) {
        const x = -half + (w * i) / SEGMENTS;
        const y = bottom + 34 + waveY(layer, x, t, s.swell);
        sp.setXYZ(i * 2, x, y, 0);
        sp.setXYZ(i * 2 + 1, x, bottom, 0);
        ep.setXYZ(i * 2, x, y + 3, 0);
        ep.setXYZ(i * 2 + 1, x, bottom, 0);
      }
      sp.needsUpdate = true;
      ep.needsUpdate = true;
      strip.computeBoundingSphere();
      edge.computeBoundingSphere();
    });

    // the ship sails the middle strip; its x is how far down the page you are
    const margin = Math.min(90, w * 0.12);
    const sx = -half + margin + voyage.progress * (w - margin * 2.6);
    const mid = LAYERS[1];
    const sy = bottom + 34 + waveY(mid, sx, t, s.swell);
    const slope =
      (waveY(mid, sx + 6, t, s.swell) - waveY(mid, sx - 6, t, s.swell)) / 12;
    if (voyage.velocity > 0.05) s.facing = 1;
    else if (voyage.velocity < -0.05) s.facing = -1;
    const boat = ship.current;
    if (boat) {
      const h = Math.min(74, size.height * 0.68);
      boat.scale.set(h * 1.33 * s.facing, h, 1);
      boat.position.set(sx, sy + h * 0.34, 0.17);
      boat.rotation.z = Math.atan(slope) * 0.9 + Math.sin(t * 2.1) * 0.04;
    }

    // the pier slides in at the end of the page, with a gull on it
    const dock = Math.max(0, (voyage.progress - 0.88) / 0.12);
    const ph = Math.min(70, size.height * 0.64);
    if (pier.current) {
      pier.current.scale.set(ph * 1.53, ph, 1);
      pier.current.position.set(
        half - ph * 0.7 + (1 - dock) * ph * 1.8,
        bottom + ph * 0.55,
        0.12,
      );
    }
    if (gull.current) {
      const gh = ph * 0.55;
      const hop = Math.abs(Math.sin(Math.floor(clock.elapsedTime * 4))) * 4;
      gull.current.scale.set(gh * 0.67, gh, 1);
      gull.current.position.set(
        half - ph * 0.42 + (1 - dock) * ph * 1.8,
        bottom + ph * 0.98 + gh * 0.4 + hop,
        0.13,
      );
    }

    // cannonballs over the Battleship report
    if (voyage.battle && clock.elapsedTime > s.nextShot) {
      s.nextShot = clock.elapsedTime + 0.7 + Math.random() * 1.1;
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
    s.splash = s.splash.filter((p) => p.life > 0);
    drops.current.forEach((mesh, i) => {
      if (!mesh) return;
      const p = s.splash[i];
      mesh.visible = Boolean(p);
      if (!p) return;
      p.vy -= 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 0.9;
      if (p.y < bottom + 20) p.life = 0;
      const r = 5 + p.life * 6;
      mesh.scale.set(r, r, 1);
      mesh.position.set(p.x, p.y, 2);
    });

    voyage.velocity *= 0.9;
    if (moving || s.splash.length || Math.abs(s.swell - 1) > 0.02) invalidate();
  });

  return (
    <>
      {LAYERS.map((layer, i) => (
        <group key={layer.color}>
          <mesh
            ref={(m) => {
              edges.current[i] = m;
            }}
            geometry={geometries[i].edge}
            position={[0, 0, i * 0.1]}
          >
            <meshBasicMaterial color={PAPER_EDGE} />
          </mesh>
          <mesh
            ref={(m) => {
              strips.current[i] = m;
            }}
            geometry={geometries[i].strip}
            position={[0, 0, i * 0.1 + 0.05]}
          >
            <meshBasicMaterial color={layer.color} />
          </mesh>
        </group>
      ))}
      {textures && (
        <>
          <mesh ref={pier}>
            <planeGeometry />
            <meshBasicMaterial
              map={textures.pier}
              transparent
              depthWrite={false}
            />
          </mesh>
          <mesh ref={gull}>
            <planeGeometry />
            <meshBasicMaterial
              map={textures.seagull}
              transparent
              depthWrite={false}
            />
          </mesh>
          {/* between the middle and front strips, so the bow dips into the sea */}
          <mesh ref={ship} renderOrder={1}>
            <planeGeometry />
            <meshBasicMaterial
              map={textures.ship}
              transparent
              depthWrite={false}
            />
          </mesh>
        </>
      )}
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
          <meshBasicMaterial map={drop} transparent depthWrite={false} />
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
      <Sea voyage={voyage} />
    </Canvas>
  );
}
