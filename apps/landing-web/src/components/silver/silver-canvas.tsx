"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { NeutralToneMapping } from "three";
import { KnotScene, SignatureScene, WaveScene } from "./scenes";
import { createStudioEnvironment } from "./studio";

export type SceneKind = "signature" | "knot" | "wave";

// Glass (transmission) cannot refract through a transparent canvas, so the
// hero scene clears to the exact page colour instead of alpha.
const opaque: Partial<Record<SceneKind, string>> = { signature: "#f2f2ef" };

const cameras: Record<
  SceneKind,
  { position: [number, number, number]; fov: number }
> = {
  signature: { position: [0, 0, 9], fov: 38 },
  knot: { position: [0, 0, 8.4], fov: 34 },
  wave: { position: [0, 0, 9.5], fov: 32 },
};

function Studio({ onReady }: { onReady: () => void }) {
  const { gl, scene, invalidate } = useThree();
  const frames = useRef(-1);
  useEffect(() => {
    const target = createStudioEnvironment(gl);
    scene.environment = target.texture;
    frames.current = 0;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, invalidate]);
  // Reveal the canvas only after the environment has lit a couple of frames.
  useFrame(() => {
    if (frames.current < 0 || frames.current > 2) return;
    if (++frames.current === 2) onReady();
    else invalidate();
  });
  return null;
}

export default function SilverCanvas({
  kind,
  active,
  dpr,
  still,
  mobile,
  onReady,
  onLost,
}: {
  kind: SceneKind;
  active: boolean;
  dpr: number;
  still: number | null;
  mobile: boolean;
  onReady: () => void;
  onLost: () => void;
}) {
  const Scene =
    kind === "signature"
      ? SignatureScene
      : kind === "knot"
        ? KnotScene
        : WaveScene;
  return (
    <Canvas
      aria-hidden="true"
      dpr={dpr}
      frameloop={still != null ? "demand" : active ? "always" : "never"}
      camera={cameras[kind]}
      gl={{
        antialias: true,
        alpha: !opaque[kind],
        powerPreference: "high-performance",
        preserveDrawingBuffer: still != null,
      }}
      onCreated={({ gl }) => {
        const clear = opaque[kind];
        if (clear) gl.setClearColor(clear, 1);
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.domElement.addEventListener("webglcontextlost", onLost, {
          once: true,
        });
      }}
      fallback={null}
    >
      <Studio onReady={onReady} />
      <Scene still={still} mobile={mobile} />
    </Canvas>
  );
}
