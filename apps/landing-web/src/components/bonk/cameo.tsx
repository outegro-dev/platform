"use client";

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
  DONE,
  FRAME_MS,
  frameAt,
  HIT_STOP,
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
  restPose,
  type Sprites,
} from "./sahur";
import { bonk, whoosh } from "./sound";

/*
 * Tung Tung Tung Sahur's cameo by a report's crooked screenshot. The page
 * never waits for him: once the frame is well on screen he walks in from
 * the nearer edge, bonks it straight and walks back off, three seconds over
 * the page with nothing of his catching the pointer, once a page view.
 * With reduced motion he only stands by the frame, the frame straight.
 * Sound comes only for a reader who has already clicked or typed on the
 * page: a page that starts making noises on its own is not a joke.
 */

let sprites: Promise<Sprites> | undefined;
const load = () => {
  sprites ??= loadSprites({
    calm: calmSprite.src,
    angry: angrySprite.src,
    bat: batSprite.src,
    stick: stickSprite.src,
    fist: fistSprite.src,
    foot: footSprite.src,
  });
  return sprites;
};

const activated = () =>
  (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation?.hasBeenActive === true;

function Actor({
  stage,
  art,
  labels,
  onImpact,
  onGone,
}: {
  stage: Stage;
  art: Sprites;
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
    const density = stage.scale * Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(ART_W * density);
    element.height = Math.round(ART_H * density);
    element.style.width = `${ART_W * stage.scale}px`;
    element.style.height = `${ART_H * stage.scale}px`;
    element.style.transformOrigin = `${FOOT_X * stage.scale}px ${GROUND * stage.scale}px`;
    ctx.setTransform(density, 0, 0, density, 0, 0);
    const sound = activated();
    let swung = false;
    let hit = false;
    let drawn = -1;
    let id = 0;
    const tick = (now: number) => {
      const t = now - start;
      // cut-out animation: hold each drawing for a frame of 15 fps
      const step = Math.floor(t / FRAME_MS);
      if (step !== drawn) {
        drawn = step;
        const f = frameAt(step * FRAME_MS, stage);
        element.style.transform = `translate(${f.x - FOOT_X * stage.scale}px, ${f.y - GROUND * stage.scale}px) scaleX(${f.facing})`;
        drawSahur(ctx, art, f.pose);
        element.style.visibility = "visible";
        // the lettering placed by its corner, not by a transform: the
        // burst's pop scales its own box, which would scale a translation
        // as far as the page is long
        if (bubble.current) {
          if (t >= WINDUP[0] && t < HIT_STOP + 200)
            bubble.current.dataset.on = "";
          else delete bubble.current.dataset.on;
          bubble.current.dataset.facing = f.facing === 1 ? "right" : "left";
          bubble.current.style.left = `${f.x}px`;
          bubble.current.style.top = `${f.y - FIGURE_H * stage.scale - 14}px`;
        }
      }
      if (!swung && t >= SWING[0]) {
        swung = true;
        if (sound) whoosh();
      }
      if (!hit && t >= SWING[1]) {
        hit = true;
        if (sound) bonk();
        if (burst.current) {
          burst.current.style.left = `${stage.hit.x}px`;
          burst.current.style.top = `${stage.hit.y}px`;
          burst.current.dataset.on = "";
        }
        callbacks.current.onImpact();
      }
      if (t >= DONE) {
        callbacks.current.onGone();
        return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [stage, art]);

  return createPortal(
    <div className="sahur-layer" data-cameo="" aria-hidden="true">
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

/** With reduced motion: standing by the frame, the bat on his shoulder. */
function Still({ frame, art }: { frame: HTMLElement; art: Sprites }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const density = Math.min(window.devicePixelRatio || 1, 2) * 0.6;
    element.width = Math.round(ART_W * density);
    element.height = Math.round(ART_H * density);
    ctx.setTransform(density, 0, 0, density, 0, 0);
    drawSahur(ctx, art, restPose);
  }, [art]);
  return createPortal(
    <span className="sahur-still" data-cameo="still" aria-hidden="true">
      <canvas ref={canvas} />
    </span>,
    frame,
  );
}

export function SahurCameo({ target }: { target: string }) {
  const t = useTranslations("bonk");
  const [stage, setStage] = useState<Stage | null>(null);
  const [art, setArt] = useState<Sprites | null>(null);
  const [still, setStill] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = document.querySelector<HTMLElement>(target);
    if (!frame) return;
    const straighten = () => {
      frame.dataset.crooked = "straight";
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // a screen ahead, so he is there when the frame comes
      const near = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          near.disconnect();
          load().then((loaded) => {
            setArt(loaded);
            setStill(frame);
          }, straighten);
        },
        { rootMargin: "100% 0px" },
      );
      near.observe(frame);
      return () => near.disconnect();
    }
    let played = false;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        near.disconnect();
        load().then(setArt, () => {});
      },
      { rootMargin: "100% 0px" },
    );
    // well on screen: three quarters of the frame in sight
    const cue = new IntersectionObserver(
      ([entry]) => {
        if (played || document.hidden || entry.intersectionRatio < 0.75) return;
        played = true;
        cue.disconnect();
        load().then((loaded) => {
          setArt(loaded);
          setStage(planStage(frame));
        }, straighten);
      },
      { threshold: [0.75, 1] },
    );
    near.observe(frame);
    cue.observe(frame);
    return () => {
      near.disconnect();
      cue.disconnect();
    };
  }, [target]);

  if (still && art) return <Still frame={still} art={art} />;
  if (!stage || !art) return null;
  return (
    <Actor
      stage={stage}
      art={art}
      labels={{ shout: t("shout"), hit: t("hit") }}
      onImpact={() => {
        const frame = document.querySelector<HTMLElement>(target);
        if (frame) frame.dataset.crooked = "straight";
      }}
      onGone={() => setStage(null)}
    />
  );
}
