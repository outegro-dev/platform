"use client";

import { getImageProps } from "next/image";
import { type ReactNode, useEffect, useRef, useState } from "react";
import paw from "@/assets/zine/paw.webp";

// the optimiser's copy for the paw's width, min(560px, 70vw) (zine-page.css)
const { props: pawImage } = getImageProps({
  src: paw,
  alt: "",
  sizes: "(max-width: 800px) 70vw, 560px",
  loading: "lazy",
});

/**
 * A cat's paw puts the block in its place: the block lies askew off its
 * place until it comes into view, then the paw reaches in from the left
 * edge, pushes it home and withdraws. Once per page view; without motion
 * (or without script) the block simply stands in its place.
 *
 * `cue`: a selector for what, once on screen, sends the paw in at once
 * (the e-mail line beside the coupon); without it, the block itself.
 */
export function CatPaw({
  children,
  cue,
}: {
  children: ReactNode;
  cue?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<
    "idle" | "armed" | "reach" | "push" | "back" | "done"
  >("idle");

  useEffect(() => {
    const zone = ref.current;
    if (!zone || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setState("armed");
    const target = (cue && document.querySelector(cue)) || zone;
    const timers: number[] = [];
    const at = (ms: number, next: typeof state) =>
      timers.push(window.setTimeout(() => setState(next), ms));
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        at(0, "reach");
        at(550, "push");
        at(1000, "back");
        at(1800, "done");
      },
      { threshold: 0.5 },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [cue]);

  return (
    <div ref={ref} className="paw-zone" data-paw={state}>
      {children}
      {/* biome-ignore lint/performance/noImgElement: a decorative sprite that only animates. */}
      <img {...pawImage} className="paw" alt="" aria-hidden="true" />
    </div>
  );
}
