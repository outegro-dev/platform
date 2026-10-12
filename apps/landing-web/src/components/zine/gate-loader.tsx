"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import "./gate-loader.css";

/**
 * The port gates: on every page load two rusty gate leaves close the page,
 * nothing written on them; a hinge bolt pops, the padlock opens, the left
 * leaf falls at the viewer and the right one slides away. The page is rendered underneath
 * and the show is pure CSS from the server markup, so a visitor without
 * scripting is never stuck. A click or Esc skips it and keeps it away for
 * the rest of the browser session (the cookie the layout checks); bots never
 * get it and reduced motion hides it in CSS. Decided on the first render:
 * the kit specimen opens straight away, and a later client navigation never
 * shuts the gates over a page in use.
 */
export function GateLoader({
  cookie,
}: {
  /** the session cookie a skip sets and the layout checks */
  cookie: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => pathname.startsWith("/design-system"));
  return open ? null : <Gate cookie={cookie} onOpen={() => setOpen(true)} />;
}

function Gate({ cookie, onOpen }: { cookie: string; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    const gate = ref.current;
    if (!gate) return;
    const skip = () => {
      // skipped once: the layout leaves the gates out until the browser closes
      const secure = location.protocol === "https:" ? "; Secure" : "";
      // biome-ignore lint/suspicious/noDocumentCookie: one plain session flag; the Cookie Store API is not everywhere yet.
      document.cookie = `${cookie}=1; Path=/; SameSite=Lax${secure}`;
      setSkipped(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip();
    };
    // the overlay's own show (or the skip fade) is over; children's ends bubble here too
    const onEnd = (event: AnimationEvent) => {
      if (event.target === gate) onOpen();
    };
    gate.addEventListener("pointerdown", skip);
    gate.addEventListener("animationend", onEnd);
    document.addEventListener("keydown", onKey);
    // hydrated after the show, or hidden by reduced motion: nothing left to wait for
    if (gate.getAnimations().every((a) => a.playState === "finished")) onOpen();
    return () => {
      gate.removeEventListener("pointerdown", skip);
      gate.removeEventListener("animationend", onEnd);
      document.removeEventListener("keydown", onKey);
    };
  }, [cookie, onOpen]);

  return (
    <div
      ref={ref}
      className="gate"
      data-state={skipped ? "skip" : undefined}
      aria-hidden="true"
    >
      <div className="gate-shield" />
      <div className="gate-leaf is-left">
        <span className="gate-hinge is-top" />
        <span className="gate-hinge is-bottom" />
        <span className="gate-hasp" />
      </div>
      <div className="gate-leaf is-right" />
      <svg className="gate-lock" viewBox="0 0 56 76" aria-hidden="true">
        <g className="gate-shackle">
          <path className="is-ink" d="M16 40V22a12 12 0 0 1 24 0v18" />
          <path className="is-steel" d="M16 40V22a12 12 0 0 1 24 0v18" />
        </g>
        <rect
          className="gate-lock-body"
          x="3"
          y="34"
          width="50"
          height="39"
          rx="6"
        />
        <path
          className="gate-keyhole"
          d="M28 44a5 5 0 0 1 3 9l2 10h-10l2-10a5 5 0 0 1 3-9z"
        />
      </svg>
      <span className="gate-bolt" />
      <span className="gate-pop" />
      <span className="gate-dust">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
