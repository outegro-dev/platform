import type { Page } from "playwright";
import { type AtsAdapter, segments } from "./adapter.js";

const HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.eu.greenhouse.io",
]);

export const isGreenhouseHost = (host: string) => HOSTS.has(host);

/** The hosted form of a posting on a board (works for EU boards too via redirect). */
export function greenhouseEmbedUrl(board: string, jobId: string, eu = false) {
  const host = eu ? "job-boards.eu.greenhouse.io" : "job-boards.greenhouse.io";
  return `https://${host}/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(jobId)}`;
}

/** A company page that embeds a Greenhouse form and names its job with ?gh_jid. */
const embedsGreenhouse = (url: URL) =>
  !HOSTS.has(url.hostname) &&
  /^\d+$/.test(url.searchParams.get("gh_jid") ?? "");

/**
 * boards.greenhouse.io/<board>/jobs/<id>, job-boards(.eu).greenhouse.io,
 * /embed/job_app?for=<board>&token=<id>, and company pages with ?gh_jid=
 * (followed to the hosted form).
 */
export const greenhouse: AtsAdapter = {
  ats: "greenhouse",
  matches: (url) => HOSTS.has(url.hostname) || embedsGreenhouse(url),
  formUrl(url) {
    if (!HOSTS.has(url.hostname)) return url.toString();
    const parts = segments(url);
    const eu = url.hostname.includes(".eu.");
    if (parts[0] === "embed") return url.toString();
    const at = parts.indexOf("jobs");
    const board = at > 0 ? parts[at - 1] : undefined;
    const id = at >= 0 ? parts[at + 1] : undefined;
    if (!board || !id || !/^\d+$/.test(id)) return url.toString();
    const host = eu
      ? "job-boards.eu.greenhouse.io"
      : "job-boards.greenhouse.io";
    return `https://${host}/${board}/jobs/${id}`;
  },
  async resolve(page: Page, url: string) {
    const target = new URL(url);
    if (!embedsGreenhouse(target)) return url;
    const jobId = target.searchParams.get("gh_jid") ?? "";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const frame = await page
      .waitForSelector(
        "#grnhse_iframe, iframe[src*='greenhouse.io/embed/job_app']",
        { state: "attached", timeout: 15_000 },
      )
      .catch(() => null);
    const src = frame ? await frame.getAttribute("src") : null;
    if (src) return new URL(src, page.url()).toString();
    const board = await page.evaluate(() => {
      const script = [...document.scripts]
        .map((s) => s.src)
        .find((s) => /greenhouse\.io\/embed\/job_board\/js/.test(s));
      return script ? new URL(script).searchParams.get("for") : null;
    });
    return board ? greenhouseEmbedUrl(board, jobId) : url;
  },
  formSelectors: [
    "form#application-form",
    "form.application--form",
    "form#application_form",
    "#application",
    "form",
  ],
  ignoreSelectors: [".iti__country-container", ".iti__dropdown-content"],
  submitSelectors: [
    "form.application--form button[type=submit]",
    "#submit_app",
    "button[type=submit]",
  ],
  successSelectors: [
    "#application_confirmation",
    ".application-confirmation",
    "[data-testid=confirmation]",
  ],
};
