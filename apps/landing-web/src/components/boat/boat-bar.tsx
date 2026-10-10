"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hardwareWebGL } from "@/lib/webgl";
import type { Voyage } from "./boat-canvas";

const BoatCanvas = dynamic(() => import("./boat-canvas"), { ssr: false });

type Stop = { href: string; page: string; title: string };

/**
 * A paper ship for a scrollbar: a strip of cut-paper sea along the bottom of
 * the screen, the ship's place on it is how far down the issue you are. It
 * turns round when you scroll back, the sea gets rough when you scroll fast,
 * cannonballs fly over the Battleship report and a pier slides in at the end.
 * The buoys are the contents: each one jumps to its page.
 *
 * The buoys are plain links and always work; the sea is a decoration that
 * starts after the first interaction, and only with motion allowed on a GPU.
 */
export function BoatBar({ label, stops }: { label: string; stops: Stop[] }) {
  const voyage = useRef<Voyage>({
    progress: 0,
    velocity: 0,
    battle: false,
    wake: () => {},
  });
  const [sea, setSea] = useState(false);
  const [shown, setShown] = useState(false);
  // the paper cartoon has its own sea and ship: step aside while it plays
  const [ashore, setAshore] = useState(false);
  const [marks, setMarks] = useState<number[]>([]);

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
      v.wake();
    };
    const battle = document.querySelector("#projects");
    const watch = new IntersectionObserver(([entry]) => {
      v.battle = entry.isIntersecting;
      v.wake();
    });
    if (battle) watch.observe(battle);
    const cartoon = document.querySelector(".pj");
    const aside = new IntersectionObserver(([entry]) =>
      setAshore(entry.isIntersecting),
    );
    if (cartoon) aside.observe(cartoon);
    measure();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    const late = window.setTimeout(measure, 1500); // fonts and images settle
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      watch.disconnect();
      aside.disconnect();
      clearTimeout(late);
    };
  }, [stops]);

  // the sea itself: off the critical path, never for reduced motion
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
      data-shown={shown && !ashore ? "" : undefined}
      data-sea={sea ? "" : undefined}
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
