"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { PerspectiveCamera } from "three";
import { createDiorama, type Diorama } from "./diorama";
import { PAPER } from "./textures";

const FPS = 12;

function Scene({
  progress,
  active,
  onReady,
}: {
  progress: RefObject<number>;
  active: boolean;
  onReady: () => void;
}) {
  const { gl, scene, invalidate } = useThree();
  const [world, setWorld] = useState<Diorama | null>(null);

  useEffect(() => {
    let cancelled = false;
    let built: Diorama | null = null;
    createDiorama(gl).then(
      (diorama) => {
        if (cancelled) {
          diorama.dispose();
          return;
        }
        built = diorama;
        scene.add(diorama.root);
        setWorld(diorama);
        invalidate();
      },
      () => {
        // Sprites failed to load: stay on the paper backdrop.
      },
    );
    return () => {
      cancelled = true;
      if (built) {
        scene.remove(built.root);
        built.dispose();
      }
    };
  }, [gl, scene, invalidate]);

  // Render on demand: every frame while the scroll is catching up, and on
  // each 12 fps tick of the stop-motion clock otherwise.
  useEffect(() => {
    if (!world || !active) return;
    let id = 0;
    let last = -1;
    const loop = (now: number) => {
      const frame = Math.floor((now / 1000) * FPS);
      if (frame !== last || !world.settled(progress.current)) {
        last = frame;
        invalidate();
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [world, active, progress, invalidate]);

  const frames = useRef(0);
  useFrame(({ camera, size, invalidate: next }, delta) => {
    if (!world) return;
    world.update(
      camera as PerspectiveCamera,
      size.width,
      size.height,
      progress.current,
      delta,
    );
    if (frames.current < 2) {
      frames.current++;
      if (frames.current === 2) onReady();
      else next();
    }
  });
  return null;
}

export default function PaperCanvas({
  active,
  dpr,
  progress,
  onReady,
  onLost,
}: {
  active: boolean;
  dpr: number;
  progress: RefObject<number>;
  onReady: () => void;
  onLost: () => void;
}) {
  return (
    <Canvas
      aria-hidden="true"
      dpr={dpr}
      flat
      shadows="percentage"
      frameloop={active ? "demand" : "never"}
      camera={{ fov: 32, near: 0.5, far: 120, position: [0, 4.9, 14] }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(PAPER, 1);
        gl.localClippingEnabled = true;
        gl.domElement.addEventListener("webglcontextlost", onLost, {
          once: true,
        });
      }}
      fallback={null}
    >
      <Scene progress={progress} active={active} onReady={onReady} />
    </Canvas>
  );
}
