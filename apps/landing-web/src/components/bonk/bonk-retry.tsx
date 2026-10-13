"use client";

import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import batSprite from "@/assets/sahur/bat.webp";
import angrySprite from "@/assets/sahur/body-angry.webp";
import calmSprite from "@/assets/sahur/body-calm.webp";
import fistSprite from "@/assets/sahur/fist.webp";
import footSprite from "@/assets/sahur/foot.webp";
import stickSprite from "@/assets/sahur/stick.webp";
import {
  DOOR_OPEN,
  FRAME_MS,
  frameAt,
  HIT_STOP,
  KNOCKS,
  LEAVE,
  planStage,
  type Stage,
  SWING,
  WINDUP,
} from "./choreography";
import {
  ART_H,
  ART_W,
  drawSahur,
  FIGURE_H,
  FOOT_X,
  GROUND,
  loadSprites,
  type Sprites,
} from "./sahur";
import { bonk, knock, whoosh } from "./sound";

/*
 * The 504 card of the issue's broken page, played from outside (see
 * IssueFlight). It waits until a "bonk-start" event reaches it, then "fails"
 * to load; a "bonk-retry" event presses its retry button for the visitor (at
 * once if it has failed, else as soon as it does), unless the keyboard is
 * on the button: that reader presses it themselves. The button turns out to
 * be a door: three knocks, Tung Tung Tung Sahur walks out, bonks the block,
 * it reloads at sixteen times the speed, and he leaves with the bat on his
 * shoulder. Once the block has "reloaded" the card sends "bonk-loaded" up
 * the page; a "bonk-reset" event arms it again, for the next time the page
 * comes this way.
 */

type Phase =
  | "static"
  | "armed"
  | "loading"
  | "failed"
  | "show"
  | "reloading"
  | "loaded";

const LOAD_MS = 1500;
/** How long the failed card is seen before its door is pressed. */
const PRESS_MS = 700;
const RELOAD_MS = 560;

function Actor({
  stage,
  sprites,
  labels,
  onImpact,
  onGone,
}: {
  stage: Stage;
  sprites: Sprites;
  labels: { shout: string; hit: string };
  onImpact: () => void;
  onGone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const burst = useRef<HTMLSpanElement>(null);
  const callbacks = useRef({ onImpact, onGone });
  callbacks.current = { onImpact, onGone };

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const start = performance.now();
    // Development only: localStorage og-bonk-slow = 10 plays it ten times slower.
    const slow =
      process.env.NODE_ENV === "production"
        ? 1
        : Number(localStorage.getItem("og-bonk-slow")) || 1;
    const leaveSpeed = 0.2 * stage.scale;
    // backing store sized for the final scale; smaller sizes are CSS-scaled
    const density = stage.scale * Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(ART_W * density);
    element.height = Math.round(ART_H * density);
    ctx.setTransform(density, 0, 0, density, 0, 0);
    let hit = false;
    let swung = false;
    let drawn = -1;
    let id = 0;
    const tick = (now: number) => {
      const t = (now - start) / slow;
      // cut-out animation: hold each drawing for a frame of 15 fps
      const step = Math.floor(t / FRAME_MS);
      if (step === drawn) {
        id = requestAnimationFrame(tick);
        return;
      }
      drawn = step;
      const f = frameAt(step * FRAME_MS, stage, leaveSpeed);
      element.style.visibility = f.visible ? "visible" : "hidden";
      element.style.width = `${ART_W * f.scale}px`;
      element.style.height = `${ART_H * f.scale}px`;
      element.style.transformOrigin = `${FOOT_X * f.scale}px ${GROUND * f.scale}px`;
      element.style.transform = `translate(${f.x - FOOT_X * f.scale}px, ${f.y - GROUND * f.scale}px) scaleX(${f.facing})`;
      drawSahur(ctx, sprites, f.pose);

      if (bubble.current) {
        const shout = t >= WINDUP[0] && t < HIT_STOP + 200;
        if (shout) bubble.current.dataset.on = "";
        else delete bubble.current.dataset.on;
        bubble.current.style.transform = `translate(${f.x}px, ${f.y - FIGURE_H * f.scale - 14}px)`;
      }
      if (!swung && t >= SWING[0]) {
        swung = true;
        whoosh();
      }
      if (!hit && t >= SWING[1]) {
        hit = true;
        bonk();
        if (burst.current) {
          burst.current.style.transform = `translate(${stage.hit.x}px, ${stage.hit.y}px)`;
          burst.current.dataset.on = "";
        }
        callbacks.current.onImpact();
      }
      const gone = t > LEAVE && f.x + 40 * f.scale < window.scrollX;
      if (gone || t > 12000) {
        callbacks.current.onGone();
        return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [stage, sprites]);

  return createPortal(
    <div className="sahur-layer" aria-hidden="true">
      <canvas
        ref={canvas}
        className="sahur"
        width={ART_W}
        height={ART_H}
        style={{ visibility: "hidden" }}
      />
      <span ref={bubble} className="sahur-bubble">
        <span>{labels.shout}</span>
      </span>
      <span ref={burst} className="sahur-burst">
        <span>{labels.hit}</span>
      </span>
    </div>,
    document.body,
  );
}

export function BonkRetry() {
  const t = useTranslations("bonk");
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const door = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>("static");
  const [knocks, setKnocks] = useState(0);
  const [doorOpen, setDoorOpen] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [sprites, setSprites] = useState<Sprites | null>(null);
  const [status, setStatus] = useState(0);
  // the door is to be pressed for the visitor
  const [pressed, setPressed] = useState(false);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) =>
    timers.current.push(window.setTimeout(run, ms));

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Armed once hydrated, loading when told to, and armed afresh when told
  // to reset (whatever it was doing, Sahur included).
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    setPhase("armed");
    const start = () => setPhase((now) => (now === "armed" ? "loading" : now));
    // not for a reader whose keyboard is on the door: they press it
    const press = () => {
      if (!door.current?.matches(":focus-visible")) setPressed(true);
    };
    const reset = () => {
      for (const id of timers.current) clearTimeout(id);
      timers.current = [];
      setStage(null);
      setKnocks(0);
      setDoorOpen(false);
      setShaking(false);
      setPressed(false);
      setStatus(0);
      setPhase("armed");
    };
    element.addEventListener("bonk-start", start);
    element.addEventListener("bonk-retry", press);
    element.addEventListener("bonk-reset", reset);
    return () => {
      element.removeEventListener("bonk-start", start);
      element.removeEventListener("bonk-retry", press);
      element.removeEventListener("bonk-reset", reset);
    };
  }, []);

  // The slow, doomed load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: timers belong to the phase.
  useEffect(() => {
    if (phase !== "loading") return;
    setStatus(0);
    later(LOAD_MS * 0.35, () => setStatus(1));
    later(LOAD_MS * 0.7, () => setStatus(2));
    later(LOAD_MS, () => setPhase("failed"));
    loadSprites({
      calm: calmSprite.src,
      angry: angrySprite.src,
      bat: batSprite.src,
      stick: stickSprite.src,
      fist: fistSprite.src,
      foot: footSprite.src,
    }).then(setSprites, () => {});
  }, [phase]);

  // the block is back: the broken page can go
  const reloaded = () => {
    setPhase("loaded");
    root.current?.dispatchEvent(new Event("bonk-loaded", { bubbles: true }));
  };

  const retry = () => {
    const c = card.current;
    const d = door.current;
    if (!c || !d) return;
    if (!sprites) {
      reloaded();
      return;
    }
    setStage(planStage(c, d));
    setPhase("show");
    for (const [i, ms] of KNOCKS.entries())
      later(ms, () => {
        knock(1 + i * 0.06);
        setKnocks(i + 1);
      });
    later(DOOR_OPEN, () => setDoorOpen(true));
  };

  // the door pressed for the visitor once the card has failed
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reads the refs of this render.
  useEffect(() => {
    if (!pressed || phase !== "failed") return;
    const id = window.setTimeout(() => {
      setPressed(false);
      retry();
    }, PRESS_MS);
    return () => window.clearTimeout(id);
  }, [pressed, phase]);

  const impactHit = () => {
    // the door goes with the failed card: focus on it waits on the card
    // until the block is back (IssueFlight takes it on from there)
    if (door.current === document.activeElement)
      card.current?.focus({ preventScroll: true });
    setShaking(true);
    setPhase("reloading");
    later(RELOAD_MS, () => {
      setShaking(false);
      reloaded();
    });
  };

  const covered = phase !== "static" && phase !== "loaded";
  const loadingLines = t.raw("loading") as string[];

  return (
    <div
      ref={root}
      className="bonk"
      data-phase={phase}
      data-shaking={shaking ? "" : undefined}
    >
      {covered && (
        <div className="bonk-overlay">
          {/* a status is polite already; an explicit aria-live would keep
              the page exposed behind an open dialog (aria-hidden skips it) */}
          <div ref={card} className="bonk-card" role="status" tabIndex={-1}>
            {phase === "armed" || phase === "loading" ? (
              <>
                <p className="bonk-status">
                  <span className="bonk-spinner" aria-hidden="true" />
                  {loadingLines[status]}
                </p>
                <div
                  className="bonk-progress"
                  role="progressbar"
                  aria-label={t("progressLabel")}
                >
                  <span />
                </div>
                <p className="bonk-log" aria-hidden="true">
                  {t("request")} … {t("pending")}
                </p>
              </>
            ) : phase === "reloading" ? (
              <>
                <p className="bonk-status">
                  <span className="bonk-fast" aria-hidden="true">
                    ×16
                  </span>
                  {t("reloading")}
                </p>
                <div className="bonk-progress is-fast">
                  <span />
                </div>
                <p className="bonk-log" aria-hidden="true">
                  {t("request")} … {t("ok")}
                </p>
              </>
            ) : (
              <>
                <WarningIcon className="bonk-icon" aria-hidden="true" />
                <p className="bonk-title">{t("errorTitle")}</p>
                <p className="bonk-body">{t("errorBody")}</p>
                <div className="bonk-door-frame">
                  {knocks > 0 && !doorOpen && (
                    <span
                      key={knocks}
                      className="bonk-knock"
                      aria-hidden="true"
                      style={{ "--knock": knocks } as React.CSSProperties}
                    >
                      {t("knock")}
                    </span>
                  )}
                  {/* pressed once; aria-disabled, as a disabled button
                      would drop the focus it holds. The keyboard coming to
                      it while it is about to be pressed for the visitor
                      takes it over */}
                  <button
                    ref={door}
                    type="button"
                    className="bonk-door"
                    data-open={doorOpen ? "" : undefined}
                    data-pressed={pressed ? "" : undefined}
                    data-knock={knocks > 0 && !doorOpen ? knocks : undefined}
                    onClick={phase === "failed" ? retry : undefined}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(":focus-visible"))
                        setPressed(false);
                    }}
                    aria-disabled={phase !== "failed"}
                  >
                    <span className="bonk-door-hole" aria-hidden="true" />
                    <span className="bonk-door-leaf">
                      <ArrowClockwiseIcon aria-hidden="true" />
                      {t("retry")}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {stage && sprites && (
        <Actor
          stage={stage}
          sprites={sprites}
          labels={{ shout: t("shout"), hit: t("hit") }}
          onImpact={impactHit}
          onGone={() => setStage(null)}
        />
      )}
    </div>
  );
}
