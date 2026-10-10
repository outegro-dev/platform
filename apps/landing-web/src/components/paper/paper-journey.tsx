"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { sprites, stepStickers } from "./sprites";
import "./paper.css";

const PaperCanvas = dynamic(() => import("./paper-canvas"), { ssr: false });

type Step = { title: string; body: string; see: string };

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
 * would crawl through the shadowed scene, so they get the sticker layout.
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
 * "Мультик на полях": the steps of the work as a paper pop-up cartoon.
 *
 * The section is tall and pins a full-height stage; scrolling through it
 * pans a React Three Fiber diorama across one station per step while the
 * caption of the current step is taped over it. The steps are a real
 * ordered list in the HTML: without scripting, with reduced motion, without
 * a hardware GPU or after a lost context it is laid out as paper notes with
 * stickers instead (the live layout only applies under
 * `(scripting: enabled) and (prefers-reduced-motion: no-preference)`).
 */
export function PaperJourney({
  steps,
  labels,
}: {
  steps: Step[];
  labels: { youSee: string };
}) {
  const ref = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [mode, setMode] = useState<"live" | "static">("live");
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [current, setCurrent] = useState(0);
  const [dpr, setDpr] = useState(1.5);

  // Decide live or static; mount the canvas shortly before the section.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !matchMedia("(scripting: enabled)").matches
    ) {
      setMode("static");
      return;
    }
    const approach = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        approach.disconnect();
        if (!hardwareWebGL()) {
          setMode("static");
          return;
        }
        const small = matchMedia("(max-width: 767px)").matches;
        setDpr(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
        setEnabled(true);
      },
      { rootMargin: "150% 0px" },
    );
    approach.observe(element);
    const view = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    view.observe(element);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      approach.disconnect();
      view.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  // Scroll progress through the pinned stage drives the scene and captions.
  useEffect(() => {
    const element = ref.current;
    if (!element || mode !== "live") return;
    const count = steps.length;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = span > 0 ? -rect.top / span : 0;
      progress.current = p;
      setCurrent(Math.min(count - 1, Math.max(0, Math.round(p * count - 0.5))));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [mode, steps.length]);

  const fail = () => {
    setEnabled(false);
    setReady(false);
    setMode("static");
  };
  const live = mode === "live";
  const running = live && enabled;

  return (
    <section
      ref={ref}
      className="pj"
      data-mode={mode}
      data-ready={running && ready ? "" : undefined}
    >
      <div className="pj-viewport">
        {live && (
          <div className="pj-stage" aria-hidden="true">
            {enabled && (
              <SceneBoundary onError={fail}>
                <PaperCanvas
                  active={inView && pageVisible}
                  dpr={dpr}
                  progress={progress}
                  onReady={() => setReady(true)}
                  onLost={fail}
                />
              </SceneBoundary>
            )}
          </div>
        )}
        <ol className="pj-steps">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="pj-step"
              data-active={i === current ? "" : undefined}
              aria-current={running && i === current ? "step" : undefined}
            >
              <div className="pj-stickers" aria-hidden="true">
                {(stepStickers[i] ?? []).map((name) => (
                  <Image
                    key={name}
                    className={`pj-sticker pj-sticker-${name}`}
                    src={sprites[name]}
                    alt=""
                    sizes="(max-width: 767px) 38vw, 200px"
                    quality={75}
                  />
                ))}
              </div>
              <div className="pj-note">
                <span className="pj-number" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="pj-title">{step.title}</h3>
                <p className="pj-body">{step.body}</p>
                <p className="pj-see">
                  <span className="pj-see-label">{labels.youSee}</span>{" "}
                  {step.see}
                </p>
              </div>
            </li>
          ))}
        </ol>
        {live && (
          <div className="pj-dots" aria-hidden="true">
            {steps.map((step, i) => (
              <span
                key={step.title}
                data-active={i === current ? "" : undefined}
              >
                {i + 1}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
