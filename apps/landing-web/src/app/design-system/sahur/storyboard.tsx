"use client";

import { useEffect, useRef } from "react";
import batSprite from "@/assets/sahur/bat.webp";
import angrySprite from "@/assets/sahur/body-angry.webp";
import calmSprite from "@/assets/sahur/body-calm.webp";
import fistSprite from "@/assets/sahur/fist.webp";
import footSprite from "@/assets/sahur/foot.webp";
import stickSprite from "@/assets/sahur/stick.webp";
import { frameAt, type Stage } from "@/components/bonk/choreography";
import { ART_H, ART_W, drawSahur, loadSprites } from "@/components/bonk/sahur";

// A stage where he comes out of a door to the right and walks left to swing.
const stage: Stage = {
  scale: 1,
  doorScale: 0.3,
  from: { x: 600, y: 300 },
  stand: { x: 200, y: 400 },
  hit: { x: 400, y: 300 },
};
const times = Array.from({ length: 36 }, (_, i) => 900 + i * 100);

/** Every 100 ms of the bonk choreography, frozen side by side. */
export function Storyboard() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    loadSprites({
      calm: calmSprite.src,
      angry: angrySprite.src,
      bat: batSprite.src,
      stick: stickSprite.src,
      fist: fistSprite.src,
      foot: footSprite.src,
    }).then((sprites) => {
      const canvases = root.current?.querySelectorAll("canvas") ?? [];
      canvases.forEach((canvas, i) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const frame = frameAt(times[i], stage, 0.2);
        drawSahur(ctx, sprites, frame.pose);
        canvas.style.transform = `scaleX(${frame.facing})`;
      });
    });
  }, []);
  return (
    <div ref={root} className="storyboard">
      {times.map((t) => (
        <figure key={t}>
          <canvas width={ART_W} height={ART_H} />
          <figcaption>{t} ms</figcaption>
        </figure>
      ))}
    </div>
  );
}
