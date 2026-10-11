"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hardwareWebGL } from "@/lib/webgl";
import type { Voyage } from "./boat-canvas";
import { SECTIONS, STAGES, type Stage } from "./stages";
import "./boat.css";

const BoatCanvas = dynamic(() => import("./boat-canvas"), { ssr: false });

type Stop = { href: string; page: string; title: string };

/**
 * The set for the section under the middle of the screen: the pier past the
 * end of the issue, undefined in a gap between sections (keep the last one).
 */
function sectionAt(atEnd: boolean): Stage | "aside" | undefined {
  if (atEnd) return "pier";
  const middle = window.innerHeight / 2;
  const main = document.querySelector("#main");
  if (main && main.getBoundingClientRect().bottom <= middle) return "pier";
  for (const [selector, stage] of SECTIONS) {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    if (box && box.top <= middle && box.bottom > middle) return stage;
  }
  return undefined;
}

/**
 * A paper strip for a scrollbar along the bottom of the screen: the rider's
 * place on it is how far down the issue you are, and the set changes with
 * the section, like scenery in a puppet theatre. A paper plane with a banner
 * over the cover, a car along the contents, the ship under fire over the
 * Battleship report, a submarine under the platform, a bus of classified
 * ads, a delivery truck with the receipt, a pigeon with the letter, and the
 * pier at the end. Riders turn round when you scroll back, the sea gets rough
 * when you scroll fast. The buoys are the contents: each one jumps to its
 * page.
 *
 * The buoys are plain links and always work; the scene is a decoration that
 * starts after the first interaction, and only with motion allowed on a GPU.
 * Otherwise the strip is flat paper in the colour of the set.
 */
export function BoatBar({ label, stops }: { label: string; stops: Stop[] }) {
  const voyage = useRef<Voyage>({
    progress: 0,
    velocity: 0,
    stage: "cover",
    shown: false,
    wake: () => {},
  });
  const [sea, setSea] = useState(false);
  const [shown, setShown] = useState(false);
  const [stage, setStage] = useState<Stage>("cover");
  // the paper cartoon has its own sea and ship: step aside while it plays
  const [aside, setAside] = useState(false);
  const [ashore, setAshore] = useState(false);
  const [marks, setMarks] = useState<number[]>([]);
  const visible = shown && !ashore && !aside;

  useEffect(() => {
    const v = voyage.current;
    let last = window.scrollY;
    let lastTime = performance.now();
    const measure = () => {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      setMarks(
        stops.map((stop) => {
          const el = document.querySelector<HTMLElement>(stop.href);
          if (!el || room <= 0) return 0;
          const top = el.getBoundingClientRect().top + window.scrollY;
          return Math.min(1, Math.max(0, top / room));
        }),
      );
    };
    const onScroll = () => {
      const now = performance.now();
      const y = window.scrollY;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      v.progress = room > 0 ? Math.min(1, Math.max(0, y / room)) : 0;
      const dt = Math.max(8, now - lastTime);
      v.velocity = v.velocity * 0.5 + ((y - last) / dt) * 0.5;
      last = y;
      lastTime = now;
      setShown(y > window.innerHeight * 0.5);
      const found = sectionAt(room > 0 && room - y < 2);
      if (found === "aside") setAside(true);
      else if (found) {
        setAside(false);
        setStage(found);
        v.stage = found;
      }
      v.wake();
    };
    const cartoon = document.querySelector(".pj");
    const watch = new IntersectionObserver(([entry]) =>
      setAshore(entry.isIntersecting),
    );
    if (cartoon) watch.observe(cartoon);
    const resize = () => {
      measure();
      onScroll();
    };
    resize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", resize);
    const late = window.setTimeout(resize, 1500); // fonts and images settle
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      watch.disconnect();
      clearTimeout(late);
    };
  }, [stops]);

  // off screen the scene sleeps, and a change of sets cuts instead of playing
  useEffect(() => {
    voyage.current.shown = visible;
    voyage.current.wake();
  }, [visible]);

  // the scene itself: off the critical path, never for reduced motion
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = () => {
      if (hardwareWebGL()) setSea(true);
    };
    const events = ["scroll", "pointermove", "pointerdown", "keydown"];
    const once = () => {
      for (const type of events) window.removeEventListener(type, once);
      start();
    };
    for (const type of events)
      window.addEventListener(type, once, { passive: true, once: true });
    return () => {
      for (const type of events) window.removeEventListener(type, once);
    };
  }, []);

  return (
    <nav
      className="boat-bar"
      aria-label={label}
      data-shown={visible ? "" : undefined}
      data-sea={sea ? "" : undefined}
      data-backdrop={STAGES[stage].backdrop}
    >
      <div className="boat-sea" aria-hidden="true">
        {sea && (
          <BoatCanvas voyage={voyage.current} onLost={() => setSea(false)} />
        )}
      </div>
      <ol className="boat-buoys">
        {stops.map((stop, i) => (
          <li
            key={stop.href}
            style={
              { "--p": marks[i] ?? i / stops.length } as React.CSSProperties
            }
          >
            <a href={stop.href} title={stop.title}>
              <span className="sr-only">{stop.title}, </span>
              {stop.page}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
