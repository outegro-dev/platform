"use client";

import { useRef } from "react";
import stampTool from "@/assets/zine/stamp.webp";
import { useOnView } from "./use-on-view";

/**
 * A rubber stamp that comes down on the page when it scrolls into view and
 * leaves its mark. The mark is in the server markup; only the slam is JS.
 */
export function Stamp({
  text,
  tone = "red",
  className,
}: {
  text: string;
  tone?: "red" | "blue";
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = useOnView(ref, { threshold: 0.9, delay: 250 });
  return (
    <span ref={ref} className={`stamp ${className ?? ""}`} data-state={state}>
      {/* biome-ignore lint/performance/noImgElement: a small decorative sprite that only animates. */}
      <img
        className="stamp-tool"
        src={stampTool.src}
        width={stampTool.width}
        height={stampTool.height}
        alt=""
        aria-hidden="true"
        loading="lazy"
      />
      <span className={`stamp-mark is-${tone}`}>{text}</span>
    </span>
  );
}
