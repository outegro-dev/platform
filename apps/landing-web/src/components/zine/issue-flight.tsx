"use client";

import { useEffect } from "react";

/** Into the flight, where the cover starts to open and where it is open:
 * open well before it lands, so it is seen opening and then read. */
const OPEN_FROM = 0.08;
const OPEN_TO = 0.8;
/** How much nearer the book comes halfway. */
const LIFT = 0.1;
/** The cover of the magazine on the first screen lies this crooked, in
 * degrees (.cover-art marks it). */
const TILT = 5;
/** Into the flight, where the flat book has taken over from the picture of
 * the magazine lying on the page. */
const FADE = 0.08;
/** Into the flight, where the book settles into its spread: from here the
 * right page's corner and the cue under the spread come in. */
const LAND = 0.9;
/**
 * The pinned stage after landing, in screen heights of scrolling. Two
 * turns, each the right page's corner peeling back (CORNER) and then its
 * leaf turning over (LEAF), so every bit of the scroll moves one or the
 * other; the first corner peels slower, as the reader lands on it. The
 * second turn breaks the issue; the rest of --issue-stage (zine-page.css,
 * 185svh in all) holds the broken page while the joke plays.
 */
const CORNER_A = 0.25;
const CORNER_B = 0.15;
const LEAF = 0.45;
/** Where the spreads rest: the contents at the pin, the report, then the
 * broken page fully up. */
const REPORT = CORNER_A + LEAF;
const BROKEN = REPORT + CORNER_B + LEAF;
const RESTS = [0, REPORT, BROKEN];
/** The lifted corner, of the page width: a dog-ear while a spread is read,
 * then peeled right back (the .book-curl box, 11% of the spread, is the
 * corner peeled back). It goes over with its leaf, folding away over the
 * first FOLD of the turn. */
const HINT_CURL = 0.06;
const PEEL_CURL = 0.22;
const FOLD = 0.3;
/** A leaf left partly over when the scroll stops settles on the spread
 * the reader was heading for once it is this far over, else back. */
const COMMIT = 0.12;
/** How fast the pages catch up with the scroll, in milliseconds: a
 * wheel's notch or a key's step glides over instead of jumping. */
const EASE_MS = 70;
/** And how far behind they may fall, in screens: a notch of the wheel. */
const LAG = 0.12;
/** Into the second turn, where the broken page starts to show, and where it
 * is up, a little before the leaf lands: only a page fully there plays the
 * joke and takes the pointer and the keyboard, its card at full ink. */
const BREAK_FROM = 0.55;
const BREAK_TO = 0.78;
/** Of the cover's opening, where the pages print their outlines (they
 * fade in, and out again as the broken page starts to come up: CSS). */
const INK_IN = 0.02;
/** Scrolling into the broken page, of the screen, that presses its retry. */
const PRESS_AT = 0.12;
/** How long the joke holds the page against the wheel, in milliseconds:
 * the run-out of the swipe that brought the broken page in. */
const HOLD_MAX = 1000;
/** Without scrollend, how long a scroll is still before it has ended. */
const QUIET_MS = 150;
/** How long a spread is read before its corner starts to beckon. */
const REST_MS = 1200;
/** A page's height, of its width: the pages are 2:3. */
const PAGE = 1.5;
/** The keys that scroll the page a step, and which way. */
const STEPS: Record<string, number> = {
  ArrowDown: 1,
  PageDown: 1,
  ArrowUp: -1,
  PageUp: -1,
};
/** Where a key belongs to the control it is pressed on, not to the page. */
const OWN_KEYS =
  "input, textarea, select, [contenteditable], [role='textbox'], [role='slider'], [role='spinbutton'], [role='listbox'], [role='menu'], [role='tablist'], [role='radiogroup']";

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
/** Gentle at both ends: the cover lifts off and settles without a jolt, a
 * leaf lifts, goes over and lies down. */
const glide = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
/** Firmer for the cover: it opens in the middle of its stretch. */
const flip = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Where a leaf left partly over settles once the scroll has stopped: the
 * spread the reader was heading for (`heading`, 1 down and -1 up) once
 * it is a little way over, else the one it came from; null while no leaf
 * is turning (a corner only lifting is still a spread to read).
 */
function settleOn(after: number, heading: number) {
  for (const [from, corner, to] of [
    [0, CORNER_A, REPORT],
    [REPORT, CORNER_B, BROKEN],
  ]) {
    const over = (after - from - corner) / LEAF;
    if (over <= 0.002 || over >= 0.998) continue;
    const on =
      heading > 0
        ? over >= COMMIT
        : heading < 0
          ? over > 1 - COMMIT
          : over >= 0.5;
    return on ? to : from;
  }
  return null;
}

/**
 * The first screen's cover flies down into the issue and opens on the way,
 * the contents page turns over to the Battleship report, and the report's
 * page turns over to nothing: the issue gives way to a broken page. On wide
 * screens with motion the book goes fixed and is placed on every scroll
 * frame:
 *
 * - the flight, from the top of the page to the scroll where the issue is
 *   pinned, in screen space: from the cover of the magazine lying on the
 *   first screen with the page at the top (the flat book fades in over the
 *   picture as it lifts off) to the right page
 *   of the pinned spread, so the book lifts off the page and stays in sight
 *   all the way, coming nearer, straightening up and meanwhile turning its
 *   cover over onto pages already printed;
 * - pinned, the scroll turns the pages and nothing else: the right page's
 *   dog-eared corner peels back, then the leaf goes over, from the contents
 *   to the report, then from the report to blank pages, while a white
 *   "failed to load" page comes up over the issue. The pages follow the
 *   scroll a beat behind, so a notch of the wheel glides; a leaf left
 *   partly over when the scroll stops settles on a spread, an arrow or a
 *   page key turns a whole leaf, and a spread read a while lifts its corner
 *   now and then. Under the spread, a cue says the scroll turns the pages,
 *   how far the issue is turned and which spread lies open. Scrolled on
 *   past the broken page, its retry presses itself and the 504 joke plays
 *   (BonkRetry), the page held a moment against the wheel that brought it
 *   in; once the block has "reloaded" the broken page is gone and a reader
 *   still on it glides on to the desktop. Scrolled back above the broken
 *   page, it is all set to break again on the way down.
 *
 * A frame reads the layout once, then writes only what has changed, and
 * the pages turn on transforms alone: the leaves, the corner and the cue's
 * rule are the compositor's to move.
 *
 * Every page stays readable and reachable in reading order: the stage
 * follows the keyboard to the spread of the page that takes focus, and
 * #projects moves to where the report is open. A page whose text outgrows
 * it (the reader's own text spacing or fonts, a window too short) keeps
 * the book on the ground, and so does a cover ready only once the reader
 * has come to the spreads, until they are back above them. There, and
 * everywhere else, the spreads lie open in their place and the magazine
 * stays a picture.
 */
export function IssueFlight() {
  useEffect(() => {
    const issue = document.querySelector<HTMLElement>(".issue");
    const pin = issue?.querySelector<HTMLElement>(".issue-pin");
    const slot = issue?.querySelector<HTMLElement>(".issue-slot");
    const book = issue?.querySelector<HTMLElement>(".book");
    const cover = book?.querySelector<HTMLImageElement>(".poster img");
    const coverLeaf = book?.querySelector<HTMLElement>(".is-cover-leaf");
    const contentsLeaf = book?.querySelector<HTMLElement>(".is-contents-leaf");
    const reportLeaf = book?.querySelector<HTMLElement>(".is-report-leaf");
    const curl = book?.querySelector<HTMLElement>(".book-curl");
    const inside = book?.querySelector<HTMLElement>(".is-inside");
    const contents = book?.querySelector<HTMLElement>(".is-contents");
    const story = book?.querySelector<HTMLElement>(".is-story");
    const screens = book?.querySelector<HTMLElement>(".is-screens");
    const cue = issue?.querySelector<HTMLElement>(".issue-turn");
    const rule = cue?.querySelector<HTMLElement>(".issue-turn-bar");
    const anchor = issue?.querySelector<HTMLElement>(".issue-anchor");
    const broken = issue?.querySelector<HTMLElement>(".issue-error");
    const joke = broken?.querySelector<HTMLElement>(".bonk");
    const poster = document.querySelector<HTMLElement>(".cover-art");
    const magazine = document.querySelector<HTMLElement>(".cover-mag");
    const desktop = document.querySelector<HTMLElement>(".desktop");
    if (
      !issue ||
      !pin ||
      !slot ||
      !book ||
      !cover ||
      !coverLeaf ||
      !contentsLeaf ||
      !reportLeaf ||
      !curl ||
      !inside ||
      !contents ||
      !story ||
      !screens ||
      !cue ||
      !rule ||
      !anchor ||
      !broken ||
      !joke ||
      !poster ||
      !magazine
    )
      return;
    const motion = matchMedia(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
    );
    // the magazine gives way only to a cover that is loaded and decoded; a
    // detached copy decodes it, as decode() never settles for an image that
    // is not painted, like the one on the hidden leaf. The cover waits
    // lazily (Poster), so only a flight fetches it.
    let ready: Promise<unknown> | undefined;
    const coverReady = () => {
      cover.loading = "eager";
      ready ??= new Promise<void>((resolve) => {
        if (cover.complete && cover.naturalWidth > 0) resolve();
        else cover.addEventListener("load", () => resolve(), { once: true });
      }).then(() => {
        const copy = new Image();
        copy.src = cover.currentSrc || cover.src;
        // a browser that never decodes off screen still takes off, a beat later
        return Promise.race([
          copy.decode().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 400)),
        ]);
      });
      return ready;
    };
    let live = true;
    let flying = false;
    let frame = 0;
    // the first take-off waits for a reader still above the spreads: a cover
    // loaded late would put the stage's height in above one already at them
    // or past them (due, then, until they are back above them)
    let flown = false;
    let due = false;
    let printing = false;
    // the 504: told to start once the broken page is up, its retry pressed
    // once the page is scrolled on, fixed until the page comes back above
    // it; then it is all set to play again
    let cued = false;
    let pressed = false;
    let mended = false;
    // as the joke starts the page holds still against the wheel's run-out,
    // so the cast stays on the card; a touch or a key lets go at once
    let holdTimer = 0;
    const still = (event: Event) => event.preventDefault();
    const release = () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener("wheel", still);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("keydown", release);
    };
    const hold = () => {
      window.addEventListener("wheel", still, { passive: false });
      window.addEventListener("touchstart", release, { passive: true });
      window.addEventListener("keydown", release);
      holdTimer = window.setTimeout(release, HOLD_MAX);
    };
    const rearm = () => {
      if (!cued && !mended) return;
      release();
      cued = false;
      pressed = false;
      mended = false;
      joke.dispatchEvent(new Event("bonk-reset"));
    };

    // what each frame has written, so the next writes only what changed
    // (and the ground takes it all off again)
    const written = new Map<HTMLElement, Map<string, string>>();
    const write = (el: HTMLElement, name: string, value: string) => {
      const own = written.get(el) ?? new Map<string, string>();
      written.set(el, own);
      if (own.get(name) === value) return;
      own.set(name, value);
      el.style.setProperty(name, value);
    };
    const mark = (el: HTMLElement, name: string, value: string | null) => {
      if (el.getAttribute(name) === value) return;
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
    };
    // the stage as the pages show it, in screens past the pin: it eases
    // after the scroll, so a notch of the wheel turns them smoothly
    let seen = Number.NaN;
    let then = 0;
    // where the stage stood at the last placing, for the handlers between
    // frames: they read no layout of their own
    let stageAt = 0;
    let screenAt = 1;
    const place = (now = performance.now()) => {
      frame = 0;
      if (!flying) {
        if (due) takeOff();
        return;
      }
      const y = window.scrollY;
      const screen = window.innerHeight;
      const to = slot.getBoundingClientRect();
      const from = poster.getBoundingClientRect(); // tilted: its centre holds
      // the scroll where the issue is pinned, and where the spread is then
      const stage = issue.getBoundingClientRect().top + y;
      stageAt = stage;
      screenAt = screen;
      const restTop = y < stage ? to.top + (y - stage) : to.top;
      const flight = clamp(stage > 0 ? y / stage : 1);
      const fly = glide(flight);
      const open = flip(clamp((flight - OPEN_FROM) / (OPEN_TO - OPEN_FROM)));
      const landed = glide(clamp((flight - LAND) / (1 - LAND)));
      const page = to.width / 2;
      const lift = 1 + LIFT * Math.sin(Math.PI * fly);
      // it lifts off in the shape of the cover lying on the page, wider than
      // a page as it is seen at a slant, and straightens into a page on the way
      const scaleX = lerp(poster.offsetWidth / page, 1, fly) * lift;
      const scaleY = lerp(poster.offsetHeight / to.height, 1, fly) * lift;
      const x = lerp(from.left + from.width / 2, to.left + page * 1.5, fly);
      const top = lerp(
        from.top + from.height / 2 + y, // where it stood at the top
        restTop + to.height / 2,
        fly,
      );
      write(book, "width", `${to.width}px`);
      write(book, "height", `${to.height}px`);
      // the picture of the magazine gives way to the book lifting off it
      const lifted = clamp(flight / FADE);
      write(magazine, "opacity", (1 - lifted).toFixed(3));
      write(
        book,
        "transform",
        `translate(${(x - page * 1.5).toFixed(1)}px, ${(top - to.height / 2).toFixed(1)}px) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}) rotate(${lerp(TILT, 0, fly).toFixed(3)}deg)`,
      );

      // pinned: the pages catch up with the scroll, a frame's step at a
      // time after a pause, never more than a notch of the wheel behind a
      // fast swipe; a jump of a screen and more is taken at once
      const after = (y - stage) / screen;
      const gap = now - then;
      const step = gap > 50 || gap <= 0 ? 1000 / 60 : gap;
      then = now;
      if (Number.isNaN(seen) || Math.abs(after - seen) > 1) seen = after;
      else seen += (after - seen) * (1 - Math.exp(-step / EASE_MS));
      seen = Math.min(after + LAG, Math.max(after - LAG, seen));
      if (Math.abs(after - seen) < 0.0005) seen = after;
      // how far over each leaf is, and how far its corner has peeled back
      const overA = clamp((seen - CORNER_A) / LEAF);
      const overB = clamp((seen - REPORT - CORNER_B) / LEAF);
      const turn = glide(overA);
      const turnOn = glide(overB);
      const peel = (from: number, length: number) =>
        (PEEL_CURL - HINT_CURL) * glide(clamp((seen - from) / length));
      const onReport = overA >= 0.5;
      // the dog-ear comes as the book lands on the contents, and with the
      // report as its page comes down; peeled on, it goes over with its leaf
      const corner = onReport
        ? (HINT_CURL * glide(clamp((overA - 0.8) / 0.2)) +
            peel(REPORT, CORNER_B)) *
          (1 - glide(clamp(overB / FOLD)))
        : (HINT_CURL * landed + peel(0, CORNER_A)) *
          (1 - glide(clamp(overA / FOLD)));
      const cornerTurn = onReport ? turnOn : turn;
      write(coverLeaf, "transform", `rotateY(${(-180 * open).toFixed(2)}deg)`);
      write(
        contentsLeaf,
        "transform",
        `rotateY(${(-180 * turn).toFixed(2)}deg)`,
      );
      write(
        reportLeaf,
        "transform",
        `rotateY(${(-180 * turnOn).toFixed(2)}deg)`,
      );
      // the corner box sits on the right page's corner: scaled from there,
      // and turned with its leaf on the spine, a page's width to its left
      write(
        curl,
        "transform",
        `translateX(${(-page).toFixed(1)}px) rotateY(${(-180 * cornerTurn).toFixed(2)}deg) translateX(${page.toFixed(1)}px) scale(${(corner / PEEL_CURL).toFixed(4)})`,
      );
      mark(curl, "data-under", onReport ? "blank" : null);
      // the pages print their outlines as the cover opens, and lose them
      // again as the broken page starts to come up over the blank ones
      book.toggleAttribute("data-inked", open > INK_IN && overB <= BREAK_FROM);
      book.toggleAttribute("data-opened", open >= 1);
      book.toggleAttribute("data-turned", turn >= 1);
      // the report is open from here, until its page starts to break (a
      // little past the turn, for the header)
      write(anchor, "top", `${Math.round(REPORT * screen + 100)}px`);
      write(
        anchor,
        "height",
        `${Math.max(1, Math.round((CORNER_B + LEAF * BREAK_FROM) * screen - 100))}px`,
      );
      // back above where the broken page comes up: the joke is ready again
      if (overB <= BREAK_FROM) rearm();
      // the broken page comes up over the issue as the page turns to blank
      const breaking = glide(
        clamp((overB - BREAK_FROM) / (BREAK_TO - BREAK_FROM)),
      );
      const blank = mended ? 0 : breaking;
      const shown = blank >= 1;
      // a reader scrolled back up off the broken page with its focus goes
      // on from the report, before the page goes inert under it
      if (!shown && broken.contains(document.activeElement)) land();
      write(broken, "opacity", blank.toFixed(3));
      broken.toggleAttribute("data-shown", shown);
      if (broken.inert === shown) broken.inert = !shown;
      if (shown && !cued) {
        cued = true;
        joke.dispatchEvent(new Event("bonk-start"));
      }
      // scrolled on into the broken page: its retry presses itself. The
      // reader's own scroll counts here, not the pages catching up with it,
      // so the page never presses on by itself once the scroll has stopped
      const broke = after - BROKEN;
      if (shown && cued && !pressed && broke > PRESS_AT) {
        pressed = true;
        hold();
        joke.dispatchEvent(new Event("bonk-retry"));
      }
      // the cue: in as the book lands, out as the issue breaks; its rule
      // fills a half a turn, and the count goes on as a leaf goes over
      write(cue, "opacity", (landed * (1 - breaking)).toFixed(3));
      const turned =
        (clamp(seen / REPORT) + clamp((seen - REPORT) / (BROKEN - REPORT))) / 2;
      write(rule, "transform", `scaleX(${turned.toFixed(4)})`);
      mark(cue, "data-at", onReport ? "2" : "1");
      // gone up past the screen: nothing to paint. Gone for good with the
      // broken page, it is not seen and out of the pointer's way. Either
      // way it is only not painted: its pages are still read, and its links
      // stay on the keyboard's way back up, where one that takes focus
      // brings the spread back (follow)
      const spent = mended && overB >= 1;
      write(book, "opacity", spent || to.bottom < 0 ? "0" : lifted.toFixed(3));
      book.toggleAttribute("data-spent", spent);
      // not caught up yet: on, the next frame
      if (seen !== after) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };

    // the reader's own scrolling (a wheel, a touch, a key) ends with the
    // pages settled; a scroll made by the page itself is left where it is
    let gesture = false;
    let heading = 0;
    let lastY = window.scrollY;
    let quiet = 0;
    let resting = 0;
    const scrollEnds = "onscrollend" in window;
    const where = () => ({
      screen: screenAt,
      stage: stageAt,
      after: (window.scrollY - stageAt) / screenAt,
    });
    const rest = () => {
      window.clearTimeout(quiet);
      window.clearTimeout(resting);
      if (!flying) return;
      const { screen, stage, after } = where();
      const settle = gesture ? settleOn(after, heading) : null;
      gesture = false;
      if (settle !== null) {
        window.scrollTo({ top: stage + settle * screen, behavior: "smooth" });
        return;
      }
      // a spread read a while, its corner only dog-eared: the corner
      // beckons now and then (one peeled back further is beckon enough)
      const reading = [0, REPORT].some((at) => Math.abs(after - at) < 0.03);
      if (reading)
        resting = window.setTimeout(
          () => mark(issue, "data-resting", ""),
          REST_MS,
        );
    };
    const scrolled = () => {
      const y = window.scrollY;
      if (y !== lastY) heading = Math.sign(y - lastY);
      lastY = y;
      window.clearTimeout(resting);
      mark(issue, "data-resting", null);
      if (!scrollEnds) {
        window.clearTimeout(quiet);
        quiet = window.setTimeout(rest, QUIET_MS);
      }
      schedule();
    };
    const touched = () => {
      gesture = true;
    };
    // an arrow or a page key turns a whole leaf, to the next spread or
    // back; past the spreads, and on a control that takes the key itself,
    // the key is the browser's
    const turnByKey = (event: KeyboardEvent) => {
      const space = event.key === " ";
      const way = space ? (event.shiftKey ? -1 : 1) : STEPS[event.key];
      if (
        !flying ||
        !way ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.closest(OWN_KEYS) ||
        (space && target?.closest("button, summary, [role='button']"))
      )
        return;
      gesture = true;
      const { screen, stage, after } = where();
      if (after < -0.02 || after > BROKEN + 0.02) return;
      const next =
        way > 0
          ? RESTS.find((at) => at > after + 0.01)
          : [...RESTS].reverse().find((at) => at < after - 0.01);
      if (next === undefined) return;
      event.preventDefault();
      gesture = false;
      window.scrollTo({ top: stage + next * screen, behavior: "smooth" });
    };

    // the block has "reloaded": the broken page goes and a reader still on
    // it goes on to the desktop, and so does a focus held on it; one who
    // has jumped or tabbed on meanwhile stays where they are
    const mend = () => {
      release();
      mended = true;
      schedule();
      const card = broken.getBoundingClientRect();
      const middle = window.innerHeight / 2;
      const focus = document.activeElement;
      const tabbedOn =
        focus instanceof HTMLElement &&
        !issue.contains(focus) &&
        focus.matches(":focus-visible");
      if (broken.contains(focus)) desktop?.focus({ preventScroll: true });
      if (card.top < middle && card.bottom > middle && !tabbedOn)
        document
          .getElementById("services")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    // the keyboard goes page by page: a page that takes focus is shown, the
    // window scrolled to where its spread lies open (the book is fixed, so
    // focus alone would not move the page); a pointer's focus stays put
    let landing = false;
    const follow = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!flying || landing || !target?.matches(":focus-visible")) return;
      const report = story.contains(target) || screens.contains(target);
      // in screens past the pin: where the spread lies open, and how long
      // before its leaf starts to go over
      const open = report ? REPORT : 0;
      const read = report ? CORNER_B : CORNER_A;
      const screen = window.innerHeight;
      const stage = issue.getBoundingClientRect().top + window.scrollY;
      const after = (window.scrollY - stage) / screen;
      if (after >= open && after <= open + read) return;
      window.scrollTo({ top: stage + open * screen, behavior: "instant" });
      cancelAnimationFrame(frame);
      place();
    };
    // a jump to #projects scrolls to the anchor past the book: the report's
    // page takes focus there, so the keyboard goes on through the report;
    // a link clicked, or the address or history taken there
    const land = () => {
      landing = true;
      story.focus({ preventScroll: true });
      landing = false;
    };
    const toReport = () => requestAnimationFrame(land);
    // a jump made before the take-off glides to where its section lay
    // then, above a stage not put in yet: once the book is placed the jump
    // is aimed again, unless the reader has taken over meanwhile
    let aimed = "";
    const unaim = () => {
      aimed = "";
    };
    const takeOver = ["wheel", "touchstart", "keydown", "pointerdown"];
    const jump = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!link?.hash || link.pathname !== window.location.pathname) return;
      if (!flying) aimed = link.hash;
      else if (link.hash === "#projects") toReport();
    };
    const arrive = () => {
      if (flying && window.location.hash === "#projects") toReport();
    };
    // the pages are 2:3; a page whose text runs past it cannot fly, while
    // lying open the page grows with it. Measured the same flying or not:
    // to the bottom of what is on the page, overflow and all, but for the
    // last margin, which the folio may take. A book just taken off and not
    // placed yet has no width to measure, and tells nothing (WebKit asks
    // before the first placing)
    const pages = [inside, contents, story, screens];
    const fits = () =>
      pages.every(
        (page) =>
          page.clientWidth === 0 ||
          [...page.children].every(
            (part) =>
              !(part instanceof HTMLElement) ||
              part.offsetTop + Math.max(part.offsetHeight, part.scrollHeight) <=
                page.clientWidth * PAGE + 1,
          ),
      );
    const ground = () => {
      flying = false;
      rearm();
      delete issue.dataset.flight;
      window.clearTimeout(resting);
      delete issue.dataset.resting;
      pin.style.removeProperty("z-index");
      for (const [el, own] of written)
        for (const name of own.keys()) el.style.removeProperty(name);
      written.clear();
      seen = Number.NaN;
      book.removeAttribute("data-inked");
      book.removeAttribute("data-opened");
      book.removeAttribute("data-turned");
      book.removeAttribute("data-spent");
      curl.removeAttribute("data-under");
      cue.removeAttribute("data-at");
      broken.removeAttribute("data-shown");
      broken.inert = true;
      anchor.removeAttribute("id");
      story.id = "projects";
    };
    // the text's size on the pages, flying or lying open, settles whether
    // the book flies: the fonts, a window's new size, the reader's spacing.
    // Its first answer, once the pages are laid out, is the first decision:
    // nothing is measured at load, and a cover that cannot fly stays
    // unfetched. The pages are measured as the observer is told, on the
    // layout just made: a frame later the blocks under the cover may be
    // unveiling, and a reading then would force their layout. Made before
    // the two observers below, which change the page in their turns, it
    // reads first when told in the same turn
    let fit = false;
    let refit = 0;
    const resized = new ResizeObserver(() => {
      fit = fits();
      refit ||= requestAnimationFrame(() => {
        refit = 0;
        if (flying && !fit) ground();
        else if (!flying && motion.matches && fit) coverReady().then(takeOff);
      });
    });
    // the first placing measures the stage once the browser has laid it out
    // (a resize observer's turn: after layout, before paint) rather than
    // forcing that layout in the middle of the change
    const settle = new ResizeObserver(() => {
      settle.disconnect();
      place();
      if (aimed)
        document
          .getElementById(aimed.slice(1))
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      unaim();
    });
    // one task: the stage, and the book over the magazine's cover. It too
    // waits for an observer's turn, so where the pin lies is read on a page
    // laid out, and the first placing follows in the same frame (the slot
    // lies deeper than the issue: the browser lays out again and tells it
    // before the paint)
    const lift = new ResizeObserver(() => {
      lift.disconnect();
      if (!live || flying || printing || !motion.matches) return;
      if (!flown && pin.getBoundingClientRect().top < window.innerHeight) {
        due = true;
        return;
      }
      if (!fits()) return;
      flying = true;
      flown = true;
      issue.dataset.flight = "";
      // the sticky pin is the fixed book's stacking context, so the pin is
      // the one raised over the page
      pin.style.zIndex = "26";
      story.removeAttribute("id");
      anchor.id = "projects";
      settle.observe(slot);
    });
    const takeOff = () => {
      due = false;
      lift.observe(issue);
    };
    const decide = () => {
      if (!motion.matches) ground();
      else if (fit) coverReady().then(takeOff);
    };
    // a printout counts its sheets from the page as it stands: the book is
    // on the ground before that, stays there whatever the page does
    // meanwhile, and takes off again after
    const toPrint = () => {
      printing = true;
      ground();
    };
    const printed = () => {
      printing = false;
      decide();
    };
    for (const page of pages)
      for (const part of [
        page,
        ...page.querySelectorAll(":scope > *, :scope > * > *"),
      ])
        resized.observe(part);

    motion.addEventListener("change", decide);
    broken.addEventListener("bonk-loaded", mend);
    book.addEventListener("focusin", follow);
    document.addEventListener("click", jump);
    window.addEventListener("hashchange", arrive);
    for (const type of takeOver)
      window.addEventListener(type, unaim, { passive: true });
    window.addEventListener("wheel", touched, { passive: true });
    window.addEventListener("touchstart", touched, { passive: true });
    window.addEventListener("keydown", turnByKey);
    if (scrollEnds) window.addEventListener("scrollend", rest);
    window.addEventListener("scroll", scrolled, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("beforeprint", toPrint);
    window.addEventListener("afterprint", printed);
    return () => {
      live = false;
      resized.disconnect();
      settle.disconnect();
      lift.disconnect();
      motion.removeEventListener("change", decide);
      broken.removeEventListener("bonk-loaded", mend);
      book.removeEventListener("focusin", follow);
      document.removeEventListener("click", jump);
      window.removeEventListener("hashchange", arrive);
      for (const type of takeOver) window.removeEventListener(type, unaim);
      window.removeEventListener("wheel", touched);
      window.removeEventListener("touchstart", touched);
      window.removeEventListener("keydown", turnByKey);
      window.removeEventListener("scrollend", rest);
      window.removeEventListener("scroll", scrolled);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("beforeprint", toPrint);
      window.removeEventListener("afterprint", printed);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(refit);
      window.clearTimeout(quiet);
      window.clearTimeout(resting);
      release();
      ground();
    };
  }, []);
  return null;
}
