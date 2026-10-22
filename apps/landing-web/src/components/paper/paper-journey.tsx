"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {
  Component,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Caption } from "./diorama";
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
 * The first context of a page is a long task (some 90 ms on a GPU, three
 * times that in software); the scene's own context after it is not.
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
 * Where on the screen the section ends, to keep there as it changes layout:
 * once its top has gone up past the screen, and only where its height is
 * the page's own scroll span (pinned in the desktop's stage, see `track`,
 * the stage's span does not change).
 */
function endToKeep(element: HTMLElement, track?: string) {
  const driver = track ? document.querySelector<HTMLElement>(track) : null;
  const box = element.getBoundingClientRect();
  return box.top < 0 && (!driver || driver.offsetParent === null)
    ? box.bottom
    : undefined;
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
 *
 * `track`: a selector for an element elsewhere whose scroll span drives the
 * cartoon instead of its own, while that element is laid out (the desktop's
 * game window, which pins the cartoon itself, see OsStage).
 *
 * `labels.scene`: what the live scene shows, read out as a picture; without
 * it the scene stays out of the accessibility tree and the steps tell it.
 * `labels.sign`: the two lines of the pier's sign, in the page's language.
 */
export function PaperJourney({
  steps,
  labels,
  track,
}: {
  steps: Step[];
  labels: { youSee: string; scene?: string; sign?: string[] };
  track?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const progress = useRef(0);
  const caption = useRef<Caption>({ right: 0.34, top: 0.75 });
  const kept = useRef<number>(undefined);
  const [mode, setMode] = useState<"live" | "static">("live");
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [current, setCurrent] = useState(0);
  const [dpr, setDpr] = useState(1.5);

  // Decide live or static: reduced motion at once, the GPU as the canvas
  // mounts, well before the section, so the scene has loaded and drawn its
  // first station by the time it scrolls in. Not further: on a wide screen
  // the first layout (the issue's spreads lying open, the desktop's stage
  // pinned) has the section three screens down, and three.js would load
  // with the first screen. Asked at load, the GPU would cost every visit
  // its long task. The sticker layout is a different height, so this late
  // it waits for the page to hold still (a jump on its way lands first)
  // and keeps what lies past the section in place (see below).
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
    let still = 0;
    let frame = 0;
    // still over a frame too: a timer can come due during a long task, and
    // the scroll that went on meanwhile is told only in the next frame
    const settle = () => {
      const y = window.scrollY;
      frame = requestAnimationFrame(() => {
        if (window.scrollY !== y) {
          wait();
          return;
        }
        window.removeEventListener("scroll", wait);
        kept.current = endToKeep(element, track);
        setMode("static");
      });
    };
    const wait = () => {
      window.clearTimeout(still);
      cancelAnimationFrame(frame);
      still = window.setTimeout(settle, 150);
    };
    const approach = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        approach.disconnect();
        if (!hardwareWebGL()) {
          window.addEventListener("scroll", wait, { passive: true });
          wait();
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
      window.clearTimeout(still);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", wait);
      approach.disconnect();
      view.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [track]);

  // A layout change once the section's top is past the screen scrolls the
  // page before it is painted, so that the section ends where it did and
  // what lies past it holds still. Measured after the change: the browser's
  // own anchoring may have moved the page by a node inside the section.
  useLayoutEffect(() => {
    const element = ref.current;
    const end = kept.current;
    if (mode !== "static" || !element || end === undefined) return;
    kept.current = undefined;
    window.scrollBy({
      top: element.getBoundingClientRect().bottom - end,
      behavior: "instant",
    });
  }, [mode]);

  // Scroll progress through the pinned stage drives the scene and captions;
  // the caption card's box tells the camera where the free room is. Read
  // once the scene is on its way: until the section comes near, the first
  // step is the current one anyway, and a reading at load would force the
  // whole page's layout in its first frame.
  useEffect(() => {
    const element = ref.current;
    const stage = viewport.current;
    const notes = list.current;
    if (!element || !stage || !notes || mode !== "live" || !enabled) return;
    const count = steps.length;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const driver = track ? document.querySelector<HTMLElement>(track) : null;
      const rect = (
        driver && driver.offsetParent !== null ? driver : element
      ).getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = span > 0 ? -rect.top / span : 0;
      progress.current = p;
      setCurrent(Math.min(count - 1, Math.max(0, Math.round(p * count - 0.5))));
      const room = stage.getBoundingClientRect();
      const card = notes.getBoundingClientRect();
      if (room.width > 0 && room.height > 0) {
        caption.current = {
          right: (card.right - room.left) / room.width,
          top: (card.top - room.top) / room.height,
        };
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // the first reading too in a frame, not forced in the middle of a commit
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    // Captions re-wrap when the fonts arrive.
    const rewrap = new ResizeObserver(schedule);
    rewrap.observe(notes);
    return () => {
      cancelAnimationFrame(frame);
      rewrap.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [mode, enabled, steps.length, track]);

  const fail = () => {
    setEnabled(false);
    setReady(false);
    if (ref.current) kept.current = endToKeep(ref.current, track);
    setMode("static");
  };
  const live = mode === "live";
  const running = live && enabled;
  // the scene is named as a picture once it runs
  const scene = running ? labels.scene : undefined;

  return (
    <section
      ref={ref}
      className="pj"
      data-mode={mode}
      data-ready={running && ready ? "" : undefined}
    >
      <div ref={viewport} className="pj-viewport">
        {live && (
          <div
            className="pj-stage"
            role="img"
            aria-label={scene}
            aria-hidden={scene ? undefined : true}
          >
            {enabled && (
              <SceneBoundary onError={fail}>
                <PaperCanvas
                  active={inView && pageVisible}
                  sign={labels.sign}
                  dpr={dpr}
                  progress={progress}
                  caption={caption}
                  onReady={() => setReady(true)}
                  onLost={fail}
                />
              </SceneBoundary>
            )}
          </div>
        )}
        <ol ref={list} className="pj-steps">
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
