"use client";

import { useEffect, useRef, useState } from "react";
import flySprite from "@/assets/zine/fly.webp";

type Point = { x: number; y: number };

const SPEED = 0.11; // px per ms
const SIZE = 46;

/**
 * Every now and then a fly lands on the page, wanders over the text in short
 * dashes, rubs its legs and leaves. Click it and it shoots off. It never
 * shows with reduced motion and waits while the tab is hidden.
 */
export function Fly({ gone }: { gone: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState("");
  const shoo = useRef<() => void>(() => {});

  useEffect(() => {
    const fly = ref.current;
    if (!fly || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let frame = 0;
    const later = (ms: number, run: () => void) => {
      clearTimeout(timer);
      timer = window.setTimeout(run, ms);
    };
    const edge = (): Point => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const side = Math.floor(Math.random() * 4);
      if (side === 0) return { x: -SIZE, y: Math.random() * h };
      if (side === 1) return { x: w + SIZE, y: Math.random() * h };
      if (side === 2) return { x: Math.random() * w, y: -SIZE };
      return { x: Math.random() * w, y: h + SIZE };
    };
    const inside = (): Point => ({
      x: window.innerWidth * (0.12 + Math.random() * 0.76),
      y: window.innerHeight * (0.15 + Math.random() * 0.7),
    });

    const run = (path: Point[], speed: number, pauses: boolean) => {
      cancelAnimationFrame(frame);
      fly.hidden = false;
      let leg = 0;
      let from = path[0];
      let t0 = performance.now();
      let rest = 0;
      let heading = 0;
      const tick = (now: number) => {
        const to = path[leg + 1];
        if (!to) {
          fly.hidden = true;
          later(18000 + Math.random() * 22000, spawn);
          return;
        }
        if (rest > now) {
          // rubbing its legs: tiny shivers on the spot
          const shiver = Math.sin(now / 18) * 1.2;
          fly.style.transform = `translate(${from.x - SIZE / 2 + shiver}px, ${from.y - SIZE / 2}px) rotate(${heading}deg)`;
          frame = requestAnimationFrame(tick);
          return;
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, ((now - t0) * speed) / length);
        heading = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        const wobble = Math.sin(now / 35) * 4;
        const x = from.x + dx * k;
        const y = from.y + dy * k;
        fly.style.transform = `translate(${x - SIZE / 2}px, ${y - SIZE / 2}px) rotate(${heading + wobble}deg)`;
        if (k >= 1) {
          leg++;
          from = to;
          t0 = now;
          if (pauses && leg < path.length - 1)
            rest = now + 400 + Math.random() * 1400;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const spawn = () => {
      if (document.hidden) return later(8000, spawn);
      const stops = 2 + Math.floor(Math.random() * 3);
      const path = [edge()];
      for (let i = 0; i < stops; i++) path.push(inside());
      path.push(edge());
      run(path, SPEED, true);
    };

    shoo.current = () => {
      const box = fly.getBoundingClientRect();
      const here = { x: box.left + SIZE / 2, y: box.top + SIZE / 2 };
      const away = {
        x: here.x + (Math.random() - 0.5) * window.innerWidth * 2,
        y: -SIZE * 4,
      };
      run([here, away], SPEED * 14, false);
      setStatus(gone);
      later(60000, spawn);
    };

    later(12000 + Math.random() * 8000, spawn);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [gone]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fly"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => shoo.current()}
      >
        {/* biome-ignore lint/performance/noImgElement: a tiny decorative sprite moved every frame. */}
        <img
          src={flySprite.src}
          width={SIZE}
          height={SIZE}
          alt=""
          draggable={false}
        />
      </button>
      <p className="sr-only" role="status">
        {status}
      </p>
    </>
  );
}
