"use client";

import dynamic from "next/dynamic";
import Image, { type StaticImageData } from "next/image";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import type { SceneKind } from "./silver-canvas";

const SilverCanvas = dynamic(() => import("./silver-canvas"), { ssr: false });

class SceneBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * WebGL2 on a real GPU. Software rasterisers (SwiftShader, llvmpipe, WARP)
 * cannot hold 60 fps with physical materials, so they get the poster.
 */
let gpuVerdict: boolean | undefined;
function hardwareWebGL() {
  if (gpuVerdict !== undefined) return gpuVerdict;
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) {
    gpuVerdict = false;
    return gpuVerdict;
  }
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : "";
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  gpuVerdict =
    !/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(
      renderer,
    );
  return gpuVerdict;
}

/**
 * The hero poster is a frame of the same scene, so the live scene can wait:
 * it starts on the first interaction, or once the page has been idle a while.
 * This keeps three.js, geometry and shader compilation off the critical path.
 */
const interactions = [
  "pointermove",
  "pointerdown",
  "wheel",
  "touchstart",
  "keydown",
  "scroll",
];
const afterFirstInteraction = (run: () => void) => {
  let done = false;
  let timer = 0;
  const go = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const type of interactions) window.removeEventListener(type, go);
    run();
  };
  for (const type of interactions)
    window.addEventListener(type, go, { passive: true, once: true });
  const idle = () => {
    timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function")
        window.requestIdleCallback(go, { timeout: 1500 });
      else go();
    }, 3500);
  };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
  return () => {
    done = true;
    clearTimeout(timer);
    for (const type of interactions) window.removeEventListener(type, go);
  };
};

/**
 * A live liquid-silver object with a pre-rendered poster of the same scene.
 * The poster is the LCP-safe first paint, the reduced-motion view and the
 * fallback when WebGL is unavailable or the context is lost.
 */
export function SilverStage({
  kind,
  poster,
  alt,
  className,
  priority = false,
  sizes,
  still = null,
}: {
  kind: SceneKind;
  poster: StaticImageData;
  alt: string;
  className?: string;
  /** Hero: preload the poster and start the scene once the page is idle. */
  priority?: boolean;
  sizes: string;
  /** Freeze time at this value (poster rendering only). */
  still?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [dpr, setDpr] = useState(1.5);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (still == null && matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    let cancelled = false;
    let stopWaiting: (() => void) | undefined;
    // The GPU probe itself costs a context creation, so it runs only when
    // the scene is about to start, never during hydration.
    const start = () => {
      if (cancelled || !hardwareWebGL()) return;
      setMobile(matchMedia("(max-width: 767px)").matches);
      setDpr(still != null ? 2 : Math.min(window.devicePixelRatio || 1, 2));
      setEnabled(true);
    };
    const approach = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        approach.disconnect();
        if (still == null) stopWaiting = afterFirstInteraction(start);
        else start();
      },
      { rootMargin: "500px 0px" },
    );
    approach.observe(element);
    const view = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    view.observe(element);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true;
      stopWaiting?.();
      approach.disconnect();
      view.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [still]);

  // The canvas renders whenever it is on screen; "ready" only gates the cross-fade.
  const onScreen = inView && pageVisible;
  const active = ready && onScreen;

  // Keep 60 fps: after warm-up, step resolution down while frames stay slow.
  useEffect(() => {
    if (!active || still != null || dpr <= 1) return;
    let frame = 0;
    let previous = 0;
    let total = 0;
    let samples = 0;
    let id = 0;
    const sample = (now: number) => {
      if (previous && frame > 60) {
        total += now - previous;
        samples++;
      }
      previous = now;
      if (++frame < 180) id = requestAnimationFrame(sample);
      else if (total / samples > 19)
        setDpr((d) => Math.max(1, Math.round(d * 0.8 * 100) / 100));
    };
    id = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(id);
  }, [active, dpr, still]);

  const fail = () => {
    setFailed(true);
    setEnabled(false);
    setReady(false);
  };
  const live = enabled && !failed;
  const state =
    !live || !ready
      ? "poster"
      : still != null
        ? "still"
        : active
          ? "running"
          : "offscreen";

  return (
    <div
      ref={ref}
      className={`silver-stage ${className ?? ""}`}
      data-scene-state={state}
    >
      <Image
        className={`silver-poster${ready && live ? " is-hidden" : ""}`}
        src={poster}
        alt={alt}
        sizes={sizes}
        preload={priority}
        fetchPriority={priority ? "high" : "auto"}
        loading={priority ? "eager" : "lazy"}
        quality={90}
        placeholder="empty"
      />
      <div
        className={`silver-live${ready && live ? " is-ready" : ""}`}
        aria-hidden="true"
      >
        {live && (
          <SceneBoundary onError={fail}>
            <SilverCanvas
              kind={kind}
              active={onScreen}
              dpr={dpr}
              still={still}
              mobile={mobile}
              onReady={() => setReady(true)}
              onLost={fail}
            />
          </SceneBoundary>
        )}
      </div>
    </div>
  );
}
