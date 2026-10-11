"use client";

import { ScissorsIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import scissors from "@/assets/zine/scissors.webp";

/**
 * "Cut out the coupon": the scissors run along the dashed line, the coupon
 * comes loose and tilts, and the contacts under it are right there. The
 * coupon's real action (booking the call) and the contacts are always in
 * the markup; cutting is only the show.
 */
export function Coupon({
  title,
  offer,
  fine,
  cut,
  done,
  action,
  children,
}: {
  title: string;
  offer: string;
  fine: string;
  cut: string;
  done: string;
  /** The main action, rendered on the server and passed through. */
  action: ReactNode;
  children: ReactNode;
}) {
  const [state, setState] = useState<"whole" | "cutting" | "cut">("whole");
  const start = () => {
    if (state !== "whole") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState("cut");
      return;
    }
    setState("cutting");
    window.setTimeout(() => setState("cut"), 1500);
  };
  return (
    <div className="coupon-wrap" data-state={state}>
      <div className="coupon">
        {/* biome-ignore lint/performance/noImgElement: a decorative sprite that only animates. */}
        <img
          className="coupon-scissors"
          src={scissors.src}
          width={scissors.width}
          height={scissors.height}
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
        <p className="coupon-title">{title}</p>
        <p className="coupon-offer">{offer}</p>
        <p className="coupon-fine">{fine}</p>
        <div className="coupon-actions">
          {action}
          <button
            type="button"
            className="coupon-cut"
            onClick={start}
            disabled={state !== "whole"}
          >
            <ScissorsIcon aria-hidden="true" />
            {cut}
          </button>
        </div>
      </div>
      <p className="coupon-done" role="status">
        {state === "cut" ? done : ""}
      </p>
      <div className="coupon-under">{children}</div>
    </div>
  );
}
