"use client";

import { type RootState, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  type Group,
  IcosahedronGeometry,
  MathUtils,
  type Mesh,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { knotGeometry, signatureGeometries, waveGeometries } from "./geometry";
import {
  createLiquidGlass,
  createLiquidSilver,
  type LiquidSettings,
} from "./material";

export type SceneProps = { still: number | null; mobile: boolean };

// One passive listener for the whole page; scenes read it every frame.
const pointer = { x: -1e4, y: -1e4, at: -1e9 };
let tracking = false;
function trackPointer() {
  if (tracking) return;
  tracking = true;
  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.at = performance.now();
    },
    { passive: true },
  );
}

const ease = (x: number) => {
  const t = MathUtils.clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

type Liquid = ReturnType<typeof createLiquidSilver>;

/** Pointer in scene space: smoothed NDC for tilt, local hit point for the swell. */
function usePointerField(
  group: React.RefObject<Group | null>,
  strength: number,
) {
  const state = useMemo(
    () => ({
      ndc: new Vector2(),
      smooth: new Vector2(),
      local: new Vector3(99, 99, 99),
      hit: new Vector3(),
      plane: new Plane(new Vector3(0, 0, 1), 0),
      raycaster: new Raycaster(),
      force: 0,
    }),
    [],
  );
  useEffect(trackPointer, []);
  return (root: RootState, dt: number, liquids: Liquid[]) => {
    const rect = root.gl.domElement.getBoundingClientRect();
    const x = ((pointer.x - rect.left) / rect.width) * 2 - 1;
    const y = -((pointer.y - rect.top) / rect.height) * 2 + 1;
    const recent = performance.now() - pointer.at < 1800;
    const near = recent && Math.abs(x) < 1.25 && Math.abs(y) < 1.25;
    state.ndc.set(near ? x : 0, near ? y : 0);
    state.smooth.x = MathUtils.damp(state.smooth.x, state.ndc.x, 2.6, dt);
    state.smooth.y = MathUtils.damp(state.smooth.y, state.ndc.y, 2.6, dt);
    state.force = MathUtils.damp(state.force, near ? strength : 0, 3, dt);
    if (near && group.current) {
      state.raycaster.setFromCamera(state.ndc, root.camera);
      if (state.raycaster.ray.intersectPlane(state.plane, state.hit)) {
        group.current.worldToLocal(state.hit);
        state.local.lerp(state.hit, 1 - Math.exp(-7 * dt));
      }
    }
    for (const liquid of liquids) {
      liquid.uniforms.uPointer.value.copy(state.local);
      liquid.uniforms.uPointerStrength.value = state.force;
    }
    return state.smooth;
  };
}

/** Accumulates time only while rendering; a still poster freezes it. */
function useSceneClock(still: number | null) {
  const clock = useRef({
    time: still ?? 0,
    age: still == null ? 0 : 99,
    frames: 0,
  });
  return (root: RootState, delta: number) => {
    const c = clock.current;
    const dt = still == null ? Math.min(delta, 1 / 20) : 0;
    c.time += dt;
    c.age += dt;
    // A still frame needs a few renders before the transmission pass settles.
    if (still != null && c.frames++ < 6) root.invalidate();
    return { t: c.time, age: c.age, dt: Math.max(dt, 1 / 60) };
  };
}

function useLiquids(count: number, settings: LiquidSettings) {
  const liquids = useMemo(
    () => Array.from({ length: count }, () => createLiquidSilver(settings)),
    [count, settings],
  );
  useEffect(
    () => () => {
      for (const liquid of liquids) liquid.material.dispose();
    },
    [liquids],
  );
  return liquids;
}

const SIGNATURE_LIQUID: LiquidSettings = {
  flow: 0.17,
  waves: 2.4,
  speed: 0.34,
  wobble: 0.08,
  closed: false,
};
const KNOT_LIQUID: LiquidSettings = {
  flow: 0.12,
  waves: 4,
  speed: 0.28,
  wobble: 0.07,
  closed: true,
};
const WAVE_LIQUID: LiquidSettings = {
  flow: 0.14,
  waves: 3.2,
  speed: 0.22,
  wobble: 0.38,
  closed: false,
};

/** Soft contact shadow drawn in 3D (the hero canvas is opaque). */
function useShadowTexture() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 116);
      g.addColorStop(0, "rgba(23,24,23,0.2)");
      g.addColorStop(0.45, "rgba(23,24,23,0.08)");
      g.addColorStop(1, "rgba(23,24,23,0)");
      ctx.fillStyle = g;
      ctx.setTransform(1, 0, 0, 0.25, 0, 0);
      ctx.fillRect(0, 0, 256, 256);
    }
    return new CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

const scrollProgress = () =>
  typeof window === "undefined"
    ? 0
    : Math.min(window.scrollY / window.innerHeight, 1.2);

export function SignatureScene({ still, mobile }: SceneProps) {
  const group = useRef<Group>(null);
  const orb = useRef<Mesh>(null);
  const geometries = useMemo(() => signatureGeometries(mobile), [mobile]);
  const liquids = useLiquids(2, SIGNATURE_LIQUID);
  const glass = useMemo(() => createLiquidGlass(0.035), []);
  const orbGeometry = useMemo(
    () => new IcosahedronGeometry(0.56, mobile ? 20 : 36),
    [mobile],
  );
  useEffect(
    () => () => {
      for (const g of geometries) g.dispose();
      orbGeometry.dispose();
      glass.material.dispose();
    },
    [geometries, orbGeometry, glass],
  );
  const shadow = useShadowTexture();
  const field = usePointerField(group, 0.42);
  const tick = useSceneClock(still);

  useFrame((root, delta) => {
    const g = group.current;
    if (!g) return;
    const { t, age, dt } = tick(root, delta);
    const p = field(root, dt, liquids);
    const scroll = scrollProgress();
    g.rotation.y =
      -0.12 + Math.sin(t * 0.42) * 0.42 + p.x * 0.38 + scroll * 0.7;
    g.rotation.x = 0.1 + Math.sin(t * 0.31) * 0.13 - p.y * 0.22 + scroll * 0.3;
    g.rotation.z = -0.12 + Math.sin(t * 0.23) * 0.07;
    g.position.y = -0.1 + Math.sin(t * 0.7) * 0.09 + scroll * 0.5;
    // The signature writes itself: N first, then L.
    const reveals = [
      ease((age - 0.1) / 1.5) * 1.1,
      ease((age - 1.0) / 1.3) * 1.1,
    ];
    liquids.forEach((liquid, i) => {
      liquid.uniforms.uTime.value = t;
      liquid.uniforms.uReveal.value = reveals[i];
    });
    glass.uniforms.uTime.value = t;
    if (orb.current) {
      const s = ease((age - 1.9) / 1.1);
      orb.current.scale.setScalar(Math.max(s, 0.0001));
      orb.current.position.set(
        0.55 + Math.sin(t * 0.5) * 0.28 - p.x * 0.2,
        0.05 + Math.sin(t * 0.63) * 0.3 - p.y * 0.14,
        1.45,
      );
    }
  });

  return (
    <>
      <mesh position={[0.3, -2.55, -0.8]} renderOrder={-1}>
        <planeGeometry args={[4.6, 0.95]} />
        <meshBasicMaterial
          map={shadow}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group ref={group} rotation={[0.1, -0.12, -0.12]} position={[0, -0.1, 0]}>
        {geometries.map((geometry, i) => (
          <mesh
            key={i === 0 ? "N" : "L"}
            geometry={geometry}
            material={liquids[i].material}
          />
        ))}
        <mesh
          ref={orb}
          geometry={orbGeometry}
          material={glass.material}
          scale={0.0001}
        />
      </group>
    </>
  );
}

export function KnotScene({ still, mobile }: SceneProps) {
  const group = useRef<Group>(null);
  const geometry = useMemo(() => knotGeometry(mobile), [mobile]);
  const liquids = useLiquids(1, KNOT_LIQUID);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const field = usePointerField(group, 0.5);
  const tick = useSceneClock(still);

  useFrame((root, delta) => {
    const g = group.current;
    if (!g) return;
    const { t, age, dt } = tick(root, delta);
    const p = field(root, dt, liquids);
    const scroll =
      typeof window === "undefined" ? 0 : window.scrollY / window.innerHeight;
    g.rotation.z = t * 0.22 + scroll * 0.35;
    g.rotation.y = Math.sin(t * 0.37) * 0.35 + p.x * 0.45;
    g.rotation.x = 0.55 + Math.sin(t * 0.29) * 0.18 - p.y * 0.3;
    const liquid = liquids[0];
    liquid.uniforms.uTime.value = t;
    liquid.uniforms.uReveal.value = ease(age / 1.8) * 1.1;
  });

  return (
    <group ref={group} rotation={[0.55, 0, 0]}>
      <mesh geometry={geometry} material={liquids[0].material} />
    </group>
  );
}

export function WaveScene({ still, mobile }: SceneProps) {
  const group = useRef<Group>(null);
  const geometries = useMemo(() => waveGeometries(mobile), [mobile]);
  const liquids = useLiquids(2, WAVE_LIQUID);
  useEffect(
    () => () => {
      for (const geometry of geometries) geometry.dispose();
    },
    [geometries],
  );
  const field = usePointerField(group, 0.7);
  const tick = useSceneClock(still);

  useFrame((root, delta) => {
    const g = group.current;
    if (!g) return;
    const { t, age, dt } = tick(root, delta);
    const p = field(root, dt, liquids);
    g.rotation.y = Math.sin(t * 0.21) * 0.1 + p.x * 0.14;
    g.rotation.x = -0.18 + Math.sin(t * 0.17) * 0.05 - p.y * 0.1;
    g.position.x = Math.sin(t * 0.12) * 0.4;
    g.position.y = 0.45;
    liquids.forEach((liquid, i) => {
      liquid.uniforms.uTime.value = t;
      liquid.uniforms.uReveal.value = ease((age - i * 0.35) / 1.9) * 1.1;
    });
  });

  return (
    <group
      ref={group}
      rotation={[-0.18, 0, 0]}
      position={[0, 0.45, 0]}
      scale={1.12}
    >
      {geometries.map((geometry, i) => (
        <mesh
          key={i === 0 ? "wide" : "thin"}
          geometry={geometry}
          material={liquids[i].material}
        />
      ))}
    </group>
  );
}
