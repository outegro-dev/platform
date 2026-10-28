import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  BrowserApplyRequest,
  BrowserApplyResponse,
} from "@outegro/contracts/atelier";
import type { BrowserContext, Locator, Page, Response } from "playwright";
import { type AtsAdapter, adapters } from "../adapters/index.js";
import {
  collect,
  type Filled,
  type FormFiles,
  fillForm,
  type Unanswered,
} from "./fill.js";
import {
  cookieDeclineButton,
  type PageSignals,
  pageSignals,
} from "./page-scripts.js";

export type RunOptions = {
  /** Epoch ms by which the answer must be ready. */
  deadline: number;
  /**
   * Tests only: open applyUrl as given (local fixtures), without the host
   * check and the canonical form URL of the adapter.
   */
  trustUrl?: boolean;
  /** Tests only: how long to watch the page after submit (30 s by default). */
  submitWaitMs?: number;
};

type Status = BrowserApplyResponse["status"];

/** Ends a run early with a status for the caller (captcha, login wall, …). */
class Stop extends Error {
  constructor(
    readonly status: Status,
    readonly reason: string,
  ) {
    super(reason);
  }
}

const SUBMIT_WAIT_MS = 30_000;
const MAX_SHOT_WIDTH = 1280;
const MAX_SHOT_HEIGHT = 12_000;

/** File name as given, without any directory part. */
export function safeFileName(name: string, fallback: string): string {
  const base = [...basename(name.replace(/\\/g, "/"))]
    .map((char) =>
      char.charCodeAt(0) < 32 || '<>:"|?*'.includes(char) ? "_" : char,
    )
    .join("")
    .trim();
  return base && base !== "." && base !== ".." ? base : fallback;
}

async function writeFiles(
  dir: string,
  req: BrowserApplyRequest,
): Promise<FormFiles> {
  const cvName = safeFileName(req.cv.fileName, "CV.pdf");
  const cvPath = join(dir, cvName);
  await writeFile(cvPath, Buffer.from(req.cv.base64, "base64"));
  let coverPath: string | null = null;
  let coverName: string | null = null;
  if (req.coverLetter?.trim()) {
    coverName = "Cover_Letter.txt";
    coverPath = join(dir, coverName);
    await writeFile(coverPath, req.coverLetter.trim(), "utf8");
  }
  return { cvPath, cvName, coverPath, coverName };
}

/** Full-page JPEG (quality 60), at most 1280 px wide. */
export async function screenshot(
  page: Page,
  timeout = 20_000,
): Promise<string | null> {
  try {
    const size = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    const image = await page.screenshot({
      type: "jpeg",
      quality: 60,
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      timeout,
      clip: {
        x: 0,
        y: 0,
        width: Math.max(1, Math.min(size.width, MAX_SHOT_WIDTH)),
        height: Math.max(1, Math.min(size.height, MAX_SHOT_HEIGHT)),
      },
    });
    return image.toString("base64");
  } catch {
    return null;
  }
}

async function signals(
  page: Page,
  adapter: AtsAdapter,
): Promise<PageSignals | null> {
  return page
    .evaluate(pageSignals, { success: adapter.successSelectors })
    .catch(() => null);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
}

/** Clicks "Decline / Reject / Necessary only" of a cookie banner, never "Accept". */
async function declineCookies(page: Page) {
  const ref = await page.evaluate(cookieDeclineButton).catch(() => null);
  if (!ref) return;
  await page
    .locator(`[data-atelier-ref="${ref}"]`)
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}

async function waitForForm(page: Page, adapter: AtsAdapter) {
  await page
    .waitForFunction(
      (roots: string[]) =>
        roots.some((selector) =>
          document
            .querySelector(selector)
            ?.querySelector("input:not([type=hidden]), select, textarea"),
        ),
      adapter.formSelectors,
      { timeout: 15_000 },
    )
    .catch(() => {});
}

/** Stops on a visible CAPTCHA challenge or a login wall. */
function checkBlockers(state: PageSignals | null, fieldCount: number) {
  if (!state) return;
  if (state.captcha) throw new Stop("needs_human", "captcha");
  if (state.passwordField || (state.loginText && fieldCount === 0))
    throw new Stop("needs_human", "login_required");
}

async function findSubmit(
  page: Page,
  adapter: AtsAdapter,
): Promise<Locator | null> {
  for (const selector of adapter.submitSelectors) {
    const button = page.locator(selector).filter({ visible: true }).first();
    if (await button.count()) return button;
  }
  const generic = page
    .getByRole("button", {
      name: /^(submit( your)?( application)?|apply( now)?|send( application)?)$/i,
    })
    .filter({ visible: true })
    .first();
  return (await generic.count()) ? generic : null;
}

type SubmitOutcome = {
  status: Status;
  reason: string | null;
  confirmation: string | null;
};

/**
 * Clicks submit and watches the page for up to 30 s: a thank-you text, a
 * success element or a confirmation URL means submitted; a challenge,
 * an email code or validation messages mean a human has to look.
 */
async function submit(
  page: Page,
  adapter: AtsAdapter,
  deadline: number,
  waitMs: number,
): Promise<SubmitOutcome> {
  const before = await signals(page, adapter);
  const button = await findSubmit(page, adapter);
  if (!button)
    return { status: "failed", reason: "submit_not_found", confirmation: null };
  const startUrl = page.url();
  // What the form sent: a person reads "POST /applications 200" next to the
  // final screenshot to tell a silent success from a silent refusal.
  const posts: string[] = [];
  const onResponse = (response: Response) => {
    const request = response.request();
    if (
      request.method() === "GET" ||
      !["xhr", "fetch", "document"].includes(request.resourceType())
    )
      return;
    const url = new URL(response.url());
    if (/google|recaptcha|hcaptcha|analytics|sentry|segment/i.test(url.host))
      return;
    posts.push(`${request.method()} ${url.pathname} ${response.status()}`);
  };
  page.on("response", onResponse);
  try {
    return await watchSubmit(
      page,
      adapter,
      button,
      before,
      startUrl,
      { deadline, waitMs },
      posts,
    );
  } finally {
    page.off("response", onResponse);
  }
}

async function watchSubmit(
  page: Page,
  adapter: AtsAdapter,
  button: Locator,
  before: PageSignals | null,
  startUrl: string,
  wait: { deadline: number; waitMs: number },
  posts: string[],
): Promise<SubmitOutcome> {
  await button.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await button.click({ timeout: 10_000 });
  const end = Math.min(Date.now() + wait.waitMs, wait.deadline);
  let errorsSince = 0;
  let lastErrors: string[] = [];
  while (Date.now() < end) {
    await page.waitForTimeout(500);
    const state = await signals(page, adapter);
    if (!state) continue; // navigating
    if (state.captcha)
      return { status: "needs_human", reason: "captcha", confirmation: null };
    const moved = state.url !== startUrl;
    if (state.success && (state.success !== before?.success || moved))
      return { status: "submitted", reason: null, confirmation: state.success };
    if (
      moved &&
      /thank|confirm|success|submitted|applied|complete/i.test(
        new URL(state.url).pathname,
      )
    )
      return {
        status: "submitted",
        reason: null,
        confirmation:
          state.success ?? `Redirected to ${new URL(state.url).pathname}`,
      };
    if (state.verification)
      return {
        status: "needs_human",
        reason: "verification_required",
        confirmation: null,
      };
    if (state.errors.length) {
      errorsSince ||= Date.now();
      lastErrors = state.errors;
      if (Date.now() - errorsSince >= 2500)
        return {
          status: "needs_human",
          reason: `validation_error: ${lastErrors.join("; ")}`.slice(0, 500),
          confirmation: null,
        };
    } else errorsSince = 0;
  }
  if (lastErrors.length)
    return {
      status: "needs_human",
      reason: `validation_error: ${lastErrors.join("; ")}`.slice(0, 500),
      confirmation: null,
    };
  const onForm = await button.isVisible().catch(() => false);
  const sent = posts.slice(-3).join(", ") || "no request seen";
  return {
    status: "needs_human",
    reason: `no_confirmation: ${onForm ? "still on the form" : "the form is gone"}; ${sent}`,
    confirmation: null,
  };
}

/** The URL to open for a request; throws Stop for a URL of another ATS. */
export function formUrlFor(req: BrowserApplyRequest): string {
  const adapter = adapters[req.ats];
  const url = new URL(req.applyUrl);
  if (!adapter.matches(url)) throw new Stop("failed", "unsupported_url");
  return adapter.formUrl(url);
}

/**
 * One application in its own browser context: open the form, stop on a
 * CAPTCHA or a login wall, fill it, screenshot it and, in mode submit,
 * submit it and wait for the confirmation.
 */
export async function runApply(
  context: BrowserContext,
  req: BrowserApplyRequest,
  options: RunOptions,
): Promise<BrowserApplyResponse> {
  const adapter = adapters[req.ats];
  let filled: Filled[] = [];
  let unanswered: Unanswered[] = [];
  let shot: string | null = null;
  const answer = (
    status: Status,
    reason: string | null,
    confirmation: string | null = null,
  ): BrowserApplyResponse => ({
    status,
    reason: reason?.slice(0, 500) ?? null,
    unanswered,
    filled,
    screenshotBase64: shot,
    confirmation: confirmation?.slice(0, 2000) ?? null,
  });

  const dir = await mkdtemp(join(tmpdir(), "atelier-apply-"));
  const page = await context.newPage();
  try {
    const files = await writeFiles(dir, req);
    let url = options.trustUrl ? req.applyUrl : formUrlFor(req);
    if (adapter.resolve) url = await adapter.resolve(page, url);

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (response && [404, 410].includes(response.status()))
      throw new Stop("failed", "posting_closed");
    await settle(page);
    await declineCookies(page);
    await waitForForm(page, adapter);

    let fields = await collect(page, adapter);
    checkBlockers(await signals(page, adapter), fields.length);
    if (!fields.length && adapter.resolve) {
      // Redirected to a company page that embeds the form.
      const embedded = await adapter.resolve(page, page.url());
      if (embedded !== page.url()) {
        await page.goto(embedded, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await settle(page);
        await waitForForm(page, adapter);
        fields = await collect(page, adapter);
        checkBlockers(await signals(page, adapter), fields.length);
      }
    }
    if (!fields.length) {
      const state = await signals(page, adapter);
      throw new Stop(
        "failed",
        state?.closedText ? "posting_closed" : "form_not_found",
      );
    }

    const result = await fillForm(
      page,
      adapter,
      req,
      files,
      options.deadline - 20_000,
    );
    filled = result.filled;
    unanswered = result.unanswered;
    const filledState = await signals(page, adapter);
    checkBlockers(filledState, fields.length);
    shot = await screenshot(page);

    if (req.mode === "prepare")
      // Messages the form already shows (e.g. "The phone number is invalid").
      return answer(
        "prepared",
        filledState?.errors.length
          ? `field_errors: ${filledState.errors.join("; ")}`
          : null,
      );
    if (unanswered.some((field) => field.required))
      return answer("needs_human", "required_unanswered");
    // Room for the last screenshot: a timeout now would hide a real submit.
    const outcome = await submit(
      page,
      adapter,
      options.deadline - 10_000,
      options.submitWaitMs ?? SUBMIT_WAIT_MS,
    );
    // The page after submit: a thank-you, an error or the untouched form.
    shot = (await screenshot(page, 5000)) ?? shot;
    return answer(outcome.status, outcome.reason, outcome.confirmation);
  } catch (error) {
    if (error instanceof Stop) {
      shot ??= await screenshot(page);
      return answer(error.status, error.reason);
    }
    throw error;
  } finally {
    await page.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export { Stop as ApplyStop };
