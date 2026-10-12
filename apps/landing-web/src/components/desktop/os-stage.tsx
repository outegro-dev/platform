"use client";

import { useEffect } from "react";

/**
 * The acts of the old computer, in screen heights of scrolling; the marks'
 * places and the stage's height in desktop.css (.os[data-stage]) add up
 * the same: the desktop is read, its windows minimise one after the other,
 * then BOOT of scrolling gives the game the time to load and open (that
 * part runs on its own, see BOOT_MS); then GAME of scrolling plays the
 * cartoon (PaperJourney follows the process mark).
 */
const READ = 0.8;
const MINIMISE = 0.5;
const BOOT = 0.9;
const GAME = 3.8;
/** Into the game, where the title screen has made way for the cartoon. */
const INTRO = 0.08;
/** One window after the other: the second starts this much later, of the act. */
const STAGGER = 0.3;
/** The loader, from the windows down to the game's window opening (ms). */
const BOOT_MS = 1400;
/** And the window's opening, after which the loader is gone (ms). */
const OPEN_MS = 450;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Pins the old computer to one screen on wide, tall-enough screens with
 * motion and plays it by scroll: the windows of the desktop shrink into
 * their taskbar buttons; once they are down the game loads by itself, the
 * loader filling over BOOT_MS whatever the scroll does, and its window
 * opens; its title screen then gives way to the cartoon by scroll.
 * Scrolled back up over the windows, the game closes and they open again.
 * The #services and #process anchors move onto the marks, which span their
 * acts. Only what is in sight can be reached by keyboard.
 */
export function OsStage() {
  useEffect(() => {
    const os = document.querySelector<HTMLElement>(".os");
    const desktop = os?.querySelector<HTMLElement>(".desktop");
    const game = os?.querySelector<HTMLElement>(".os-game");
    const taskbar = os?.querySelector<HTMLElement>(".xp-taskbar");
    const servicesMark = os?.querySelector<HTMLElement>(".os-mark.is-services");
    const processMark = os?.querySelector<HTMLElement>(".os-mark.is-process");
    if (!os || !desktop || !game || !taskbar || !servicesMark || !processMark)
      return;
    const windows = [...desktop.querySelectorAll<HTMLElement>(".xp-window")];
    const buttons = [
      ...taskbar.querySelectorAll<HTMLElement>(
        ".xp-tasks > span:not(.is-game)",
      ),
    ];
    const stage = matchMedia(
      "(min-width: 1280px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)",
    );
    let on = false;
    let frame = 0;
    // where each window goes: from its centre to its taskbar button's
    let routes: { x: number; y: number }[] = [];
    // the game: loading (a timer running), then open
    let loading = 0;
    let opening = 0;
    let booted = false;

    const boot = () => {
      if (loading || booted) return;
      os.toggleAttribute("data-loading", true);
      loading = window.setTimeout(() => {
        loading = 0;
        booted = true;
        os.toggleAttribute("data-game", true);
        game.inert = false;
        opening = window.setTimeout(
          () => os.removeAttribute("data-loading"),
          OPEN_MS,
        );
      }, BOOT_MS);
    };
    const shutDown = () => {
      window.clearTimeout(loading);
      window.clearTimeout(opening);
      loading = 0;
      booted = false;
      os.removeAttribute("data-loading");
      os.removeAttribute("data-game");
      game.inert = true;
    };

    const measure = () => {
      routes = windows.map((win, i) => {
        const from = win.getBoundingClientRect();
        const to = buttons[i]?.getBoundingClientRect() ?? from;
        return {
          x: to.left + to.width / 2 - (from.left + from.width / 2),
          y: to.top + to.height / 2 - (from.top + from.height / 2),
        };
      });
    };
    const place = () => {
      frame = 0;
      if (!on) return;
      const screen = window.innerHeight;
      const y = -os.getBoundingClientRect().top / screen;
      const minimise = clamp((y - READ) / MINIMISE);
      const play = clamp((y - READ - MINIMISE - BOOT) / GAME);
      if (minimise === 0) measure();
      const spread = 1 - STAGGER * (windows.length - 1);
      windows.forEach((win, i) => {
        const m = ease(clamp((minimise - i * STAGGER) / spread));
        const route = routes[i] ?? { x: 0, y: 0 };
        win.style.transform = m
          ? `translate(${route.x * m}px, ${route.y * m}px) scale(${1 - 0.94 * m})`
          : "";
        win.style.filter = m ? `opacity(${1 - clamp((m - 0.55) / 0.45)})` : "";
      });
      os.style.setProperty("--intro", (1 - clamp(play / INTRO)).toFixed(3));
      const down = minimise >= 1;
      os.toggleAttribute("data-minimised", down);
      if (down) boot();
      else shutDown();
      desktop.inert = minimise > 0.5;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const start = () => {
      if (on || !stage.matches) return;
      on = true;
      os.dataset.stage = "";
      os.style.setProperty("--boot", `${BOOT_MS}ms`);
      game.inert = true;
      desktop.removeAttribute("id");
      game.removeAttribute("id");
      servicesMark.id = "services";
      processMark.id = "process";
      measure();
      place();
    };
    const stop = () => {
      on = false;
      shutDown();
      delete os.dataset.stage;
      os.removeAttribute("data-minimised");
      for (const name of ["--intro", "--boot"]) os.style.removeProperty(name);
      for (const win of windows) {
        win.style.transform = "";
        win.style.filter = "";
      }
      desktop.inert = false;
      game.inert = false;
      servicesMark.removeAttribute("id");
      processMark.removeAttribute("id");
      desktop.id = "services";
      game.id = "process";
    };
    const decide = () => (stage.matches ? start() : stop());

    decide();
    stage.addEventListener("change", decide);
    window.addEventListener("scroll", schedule, { passive: true });
    const resize = () => {
      if (on) measure();
      schedule();
    };
    window.addEventListener("resize", resize);
    return () => {
      stage.removeEventListener("change", decide);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
      stop();
    };
  }, []);
  return null;
}
