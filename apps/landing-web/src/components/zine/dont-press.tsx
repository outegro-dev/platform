"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import sahur from "@/assets/zine/sahur-full.webp";
import { bonk, knock, whoosh } from "../bonk/sound";
import { type Collapse, collapse } from "./collapse";

type Labels = {
  button: string;
  note: string;
  hint: string;
  sahur: string;
  command: string;
  output: string;
  revert: string;
  rew: string;
  done: string;
  reduced: string;
};

type Phase = "idle" | "fallen" | "typing" | "ready" | "rewinding";

const AUTO_REVERT_MS = 14000;
const REWIND_MS = 1400;

/**
 * The big red button nobody should press. Pressing it collapses the page
 * into a pile (throw the pieces around), Tung Tung Tung Sahur walks by, a
 * terminal types `git revert HEAD`, and a VHS rewind puts everything back:
 * in production a rollback is a revert too.
 */
export function DontPress({ labels }: { labels: Labels }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState("");
  const world = useRef<Collapse | null>(null);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  useEffect(
    () => () => {
      for (const id of timers.current) clearTimeout(id);
      world.current?.stop();
      document.documentElement.style.overflow = "";
    },
    [],
  );

  const press = () => {
    if (phase !== "idle") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStatus(labels.reduced);
      return;
    }
    setStatus("");
    bonk();
    document.documentElement.style.overflow = "hidden";
    let sounds = 0;
    let lastSound = 0;
    world.current = collapse(window.innerHeight - 40, () => {
      const t = performance.now();
      if (sounds > 14 || t - lastSound < 70) return;
      sounds++;
      lastSound = t;
      knock(0.7 + Math.random() * 0.6, 0.12);
    });
    setPhase("fallen");
    later(2600, () => {
      setPhase("typing");
      for (let i = 1; i <= labels.command.length; i++)
        later(i * 70, () => setTyped(labels.command.slice(0, i)));
      later(labels.command.length * 70 + 300, () => setPhase("ready"));
    });
    later(AUTO_REVERT_MS, () => revert());
  };

  const revert = async () => {
    const w = world.current;
    if (!w) return;
    world.current = null;
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
    setPhase("rewinding");
    whoosh(0.2);
    const t0 = performance.now();
    await w.rewind(REWIND_MS);
    const seconds = ((performance.now() - t0) / 1000).toFixed(1);
    document.documentElement.style.overflow = "";
    setTyped("");
    setPhase("idle");
    setStatus(labels.done.replace("{seconds}", seconds));
    later(6000, () => setStatus(""));
  };

  // the pile can be thrown around until the rewind
  const grabbed = useRef<number | null>(null);
  const live = phase === "fallen" || phase === "typing" || phase === "ready";

  return (
    <div className="dont-press">
      <button
        type="button"
        className="dont-press-button"
        onClick={press}
        aria-describedby="dont-press-note"
      >
        <span>{labels.button}</span>
      </button>
      <p id="dont-press-note" className="dont-press-note">
        {labels.note}
        <small>{labels.hint}</small>
      </p>
      <p className="dont-press-status" role="status">
        {status}
      </p>

      {phase !== "idle" &&
        createPortal(
          <div className="chaos" data-phase={phase}>
            {live && (
              <div
                className="chaos-catcher"
                aria-hidden="true"
                onPointerDown={(e) => {
                  const i = world.current?.grab(e.clientX, e.clientY) ?? null;
                  grabbed.current = i;
                  if (i !== null)
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (grabbed.current !== null)
                    world.current?.drag(grabbed.current, e.clientX, e.clientY);
                }}
                onPointerUp={() => {
                  if (grabbed.current !== null)
                    world.current?.release(grabbed.current);
                  grabbed.current = null;
                }}
              />
            )}
            <figure className="chaos-sahur" aria-hidden="true">
              {/* biome-ignore lint/performance/noImgElement: a decorative sprite that only animates. */}
              <img
                src={sahur.src}
                width={sahur.width}
                height={sahur.height}
                alt=""
              />
              <figcaption>{labels.sahur}</figcaption>
            </figure>
            {phase !== "fallen" && (
              <div className="chaos-terminal" role="dialog" aria-label="git">
                <p>
                  <span className="chaos-prompt">$</span> {typed}
                  {phase === "typing" && <span className="chaos-caret" />}
                </p>
                {phase !== "typing" && (
                  <p className="chaos-output">{labels.output}</p>
                )}
                {phase === "ready" && (
                  <button
                    type="button"
                    className="chaos-revert"
                    // biome-ignore lint/a11y/noAutofocus: the only action left on screen.
                    autoFocus
                    onClick={revert}
                  >
                    {labels.revert} ↵
                  </button>
                )}
              </div>
            )}
            {phase === "rewinding" && (
              <div className="chaos-vhs" aria-hidden="true">
                <span>{labels.rew}</span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
