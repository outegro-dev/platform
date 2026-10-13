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
/**
 * The pinned stage after landing, in screen heights of scrolling, twice
 * over: a spread is read while the right page's corner lifts a little
 * (HOLD, then READ for the report), the corner peels back, the page turns
 * over. The second turn breaks the issue; the rest of --issue-stage
 * (zine-page.css, 385svh in all) holds the broken page.
 */
const HOLD = 0.35;
const PEEL = 0.25;
const TURN = 0.7;
const READ = 0.8;
/** The lifted corner, of the page width: a hint, then peeled right back. */
const HINT_CURL = 0.06;
const PEEL_CURL = 0.22;
/** Into the second turn, where the broken page starts to show, and where it
 * is up, a little before the leaf lands: only a page fully there plays the
 * joke and takes the pointer and the keyboard, its card at full ink. */
const BREAK_FROM = 0.55;
const BREAK_TO = 0.78;
/** Scrolling into the broken page, of the screen, that presses its retry. */
const PRESS_AT = 0.12;
/** How long the joke holds the page against the wheel, in milliseconds:
 * the run-out of the swipe that brought the broken page in. */
const HOLD_MAX = 1000;
/** A page's height, of its width: the pages are 2:3. */
const PAGE = 1.5;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
/** Gentle at both ends: the cover lifts off and settles without a jolt. */
const glide = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
/** Firmer for a leaf: it turns over in the middle of its stretch. */
const flip = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

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
 * - pinned, each spread is read while the right page's corner lifts a
 *   little, then the corner peels back and the page turns over: from the
 *   contents to the report, then from the report to blank pages, while a
 *   white "failed to load" page comes up over the issue. Scrolled on, its
 *   retry presses itself and the 504 joke plays (BonkRetry), the page held
 *   a moment against the wheel that brought it in; once the block has
 *   "reloaded" the broken page is gone and a reader still on it glides on
 *   to the desktop. Scrolled back above the broken page, it is all set to
 *   break again on the way down.
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
    const inside = book?.querySelector<HTMLElement>(".is-inside");
    const contents = book?.querySelector<HTMLElement>(".is-contents");
    const story = book?.querySelector<HTMLElement>(".is-story");
    const screens = book?.querySelector<HTMLElement>(".is-screens");
    const anchor = issue?.querySelector<HTMLElement>(".issue-anchor");
    const broken = issue?.querySelector<HTMLElement>(".issue-error");
    const joke = broken?.querySelector<HTMLElement>(".bonk");
    const poster = document.querySelector<HTMLElement>(".cover-art");
    const magazine = document.querySelector<HTMLElement>(".cover-mag");
    if (
      !issue ||
      !pin ||
      !slot ||
      !book ||
      !cover ||
      !inside ||
      !contents ||
      !story ||
      !screens ||
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

    const place = () => {
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
      const restTop = y < stage ? to.top + (y - stage) : to.top;
      const flight = clamp(stage > 0 ? y / stage : 1);
      const fly = glide(flight);
      const open = flip(clamp((flight - OPEN_FROM) / (OPEN_TO - OPEN_FROM)));
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
      // pinned: the corner, then the page, twice
      const after = (y - stage) / screen;
      const first = HOLD + PEEL + TURN; // the report is open from here
      const second = first + READ; // and its page starts to peel here
      const turning = clamp((after - HOLD - PEEL) / TURN);
      const turningOn = clamp((after - second - PEEL) / TURN);
      const turn = flip(turning);
      const turnOn = flip(turningOn);
      // a corner goes with its page once the page is turning
      const corner = (start: number, read: number, turned: number) =>
        page *
        (HINT_CURL * glide(clamp((after - start) / (HOLD * 0.4))) +
          (PEEL_CURL - HINT_CURL) *
            glide(clamp((after - start - read) / PEEL))) *
        (1 - glide(clamp(turned / 0.3)));
      const curlA = corner(0, HOLD, turning);
      const curlB = turning < 1 ? 0 : corner(first, READ, turningOn);
      book.style.width = `${to.width}px`;
      book.style.height = `${to.height}px`;
      // the picture of the magazine gives way to the book lifting off it
      const lifted = clamp(flight / FADE);
      magazine.style.opacity = (1 - lifted).toFixed(3);
      book.style.transform = `translate(${x - page * 1.5}px, ${top - to.height / 2}px) scale(${scaleX}, ${scaleY}) rotate(${lerp(TILT, 0, fly)}deg)`;
      book.style.setProperty("--open", open.toFixed(4));
      book.style.setProperty("--turn", turn.toFixed(4));
      book.style.setProperty("--turn-on", turnOn.toFixed(4));
      book.style.setProperty("--curl-a", `${curlA.toFixed(1)}px`);
      book.style.setProperty("--curl-b", `${curlB.toFixed(1)}px`);
      book.style.setProperty(
        "--curl",
        `${Math.max(curlA, curlB).toFixed(1)}px`,
      );
      book.toggleAttribute("data-opened", open >= 1);
      book.toggleAttribute("data-turned", turn >= 1);
      // the report is open from here, for a spread's reading (a little past
      // the turn, for the header)
      anchor.style.top = `${first * screen + 100}px`;
      anchor.style.height = `${READ * screen - 100}px`;
      // back above where the broken page comes up: the joke is ready again
      if (turningOn <= BREAK_FROM) rearm();
      // the broken page comes up over the issue as the page turns to blank
      const blank = mended
        ? 0
        : glide(clamp((turningOn - BREAK_FROM) / (BREAK_TO - BREAK_FROM)));
      const shown = blank >= 1;
      broken.style.opacity = blank.toFixed(3);
      broken.toggleAttribute("data-shown", shown);
      broken.inert = !shown;
      if (shown && !cued) {
        cued = true;
        joke.dispatchEvent(new Event("bonk-start"));
      }
      // scrolled on into the broken page: its retry presses itself
      const broke = after - second - PEEL - TURN;
      if (shown && cued && !pressed && broke > PRESS_AT) {
        pressed = true;
        hold();
        joke.dispatchEvent(new Event("bonk-retry"));
      }
      // gone up past the screen: nothing to paint. Gone for good with the
      // broken page, it is not seen and out of the pointer's way, but its
      // links stay on the keyboard's way back up: one that takes focus
      // brings the spread back (follow)
      const spent = mended && turningOn >= 1;
      book.style.visibility = to.bottom < 0 ? "hidden" : "";
      book.style.opacity = spent ? "0" : lifted.toFixed(3);
      book.toggleAttribute("data-spent", spent);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    // the block has "reloaded": the broken page goes and a reader still on
    // it goes on to the desktop; one who has jumped or tabbed on meanwhile
    // stays where they are
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
      // before its corner peels
      const open = report ? HOLD + PEEL + TURN : 0;
      const read = report ? READ : HOLD;
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
    // a link clicked, or the address or history taken there. A book hidden
    // far off the screen cannot take focus: then it is taken once the
    // glide there has ended, if it has ended there
    const land = () => {
      if (book.style.visibility === "hidden") return;
      landing = true;
      story.focus({ preventScroll: true });
      landing = false;
    };
    const toReport = () =>
      requestAnimationFrame(() => {
        if (book.style.visibility !== "hidden") land();
        else window.addEventListener("scrollend", land, { once: true });
      });
    const jump = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        flying &&
        link?.hash === "#projects" &&
        link.pathname === window.location.pathname
      )
        toReport();
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
      magazine.style.removeProperty("opacity");
      pin.style.removeProperty("z-index");
      for (const name of [
        "width",
        "height",
        "transform",
        "visibility",
        "opacity",
      ])
        book.style.removeProperty(name);
      for (const name of [
        "--open",
        "--turn",
        "--turn-on",
        "--curl",
        "--curl-a",
        "--curl-b",
      ])
        book.style.removeProperty(name);
      book.removeAttribute("data-opened");
      book.removeAttribute("data-turned");
      book.removeAttribute("data-spent");
      broken.style.removeProperty("opacity");
      broken.removeAttribute("data-shown");
      broken.inert = true;
      anchor.removeAttribute("id");
      anchor.style.removeProperty("height");
      story.id = "projects";
    };
    // the first placing measures the stage once the browser has laid it out
    // (a resize observer's turn: after layout, before paint) rather than
    // forcing that layout in the middle of the change
    const settle = new ResizeObserver(() => {
      settle.disconnect();
      place();
    });
    // one task: the stage, and the book over the magazine's cover
    const takeOff = () => {
      due = false;
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
    };
    const decide = () => {
      if (!motion.matches) ground();
      else if (fits()) coverReady().then(takeOff);
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
    // the text's size on the pages, flying or lying open, settles whether
    // the book flies: the fonts, a window's new size, the reader's spacing.
    // Its first answer, once the pages are laid out, is the first decision:
    // nothing is measured at load, and a cover that cannot fly stays unfetched
    let refit = 0;
    const resized = new ResizeObserver(() => {
      refit ||= requestAnimationFrame(() => {
        refit = 0;
        if (flying && !fits()) ground();
        else if (!flying && motion.matches && fits())
          coverReady().then(takeOff);
      });
    });
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
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("beforeprint", toPrint);
    window.addEventListener("afterprint", printed);
    return () => {
      live = false;
      settle.disconnect();
      resized.disconnect();
      motion.removeEventListener("change", decide);
      broken.removeEventListener("bonk-loaded", mend);
      book.removeEventListener("focusin", follow);
      document.removeEventListener("click", jump);
      window.removeEventListener("hashchange", arrive);
      window.removeEventListener("scrollend", land);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("beforeprint", toPrint);
      window.removeEventListener("afterprint", printed);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(refit);
      release();
      ground();
    };
  }, []);
  return null;
}
