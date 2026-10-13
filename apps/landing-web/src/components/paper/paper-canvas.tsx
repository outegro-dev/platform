"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  getConsoleFunction,
  type PerspectiveCamera,
  setConsoleFunction,
} from "three";
import { type Caption, createDiorama, type Diorama } from "./diorama";
import { PAPER } from "./textures";

const FPS = 12;

// R3F 9 keeps its frame time on THREE.Clock, deprecated since r183, and
// three warns about it for every canvas; nothing here can act on that, so
// that one line stays out of the console and the rest goes on as before
const tell = getConsoleFunction();
setConsoleFunction((type, message, ...params) => {
  if (message.startsWith("THREE.Clock:")) return;
  if (tell) tell(type, message, ...params);
  else console[type](message, ...params);
});

function Scene({
  progress,
  caption,
  active,
  sign,
  onReady,
}: {
  progress: RefObject<number>;
  caption: RefObject<Caption>;
  active: boolean;
  sign?: string[];
  onReady: () => void;
}) {
  const { gl, scene, invalidate } = useThree();
  const [world, setWorld] = useState<Diorama | null>(null);
  // the sign's lines as one value: a new language builds the scene anew
  const lines = sign?.join("\n");

  useEffect(() => {
    let cancelled = false;
    let built: Diorama | null = null;
    createDiorama(gl, lines?.split("\n")).then(
      (diorama) => {
        if (cancelled) {
          diorama.dispose();
          return;
        }
        built = diorama;
        scene.add(diorama.root);
        setWorld(diorama);
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
  }, [gl, scene, lines]);

  // The first frames, once useFrame below sees the world (a frame requested
  // before this commit would find none and end the on-demand loop).
  useEffect(() => {
    if (world) invalidate();
  }, [world, invalidate]);

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
      caption.current,
    );
    if (frames.current < 2) {
      frames.current++;
      if (frames.current === 2) onReady();
      else next();
    }
  });
  return null;
}

/**
 * Renders on demand only. The first frames are drawn as soon as the scene
 * has loaded, even off screen, so the section arrives with station 1 already
 * standing; the clock runs only while `active`.
 */
export default function PaperCanvas({
  active,
  sign,
  dpr,
  progress,
  caption,
  onReady,
  onLost,
}: {
  active: boolean;
  sign?: string[];
  dpr: number;
  progress: RefObject<number>;
  caption: RefObject<Caption>;
  onReady: () => void;
  onLost: () => void;
}) {
  return (
    <Canvas
      aria-hidden="true"
      dpr={dpr}
      flat
      shadows="percentage"
      frameloop="demand"
      camera={{ fov: 32, near: 0.5, far: 120, position: [0, 4.9, 14] }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(PAPER, 1);
        gl.domElement.addEventListener("webglcontextlost", onLost, {
          once: true,
        });
      }}
      fallback={null}
    >
      <Scene
        progress={progress}
        caption={caption}
        active={active}
        sign={sign}
        onReady={onReady}
      />
    </Canvas>
  );
}
