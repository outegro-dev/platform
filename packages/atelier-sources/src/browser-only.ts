import type { HttpResponse } from "./http.js";

// Work Finder's EN/RU words, plus the same in German, French, Spanish,
// Portuguese, Italian, Dutch and Polish postings.
const vacancyWords =
  /(experience|requirement|responsib|you will|you['’]ll|we are|we['’]re|the role|about you|qualifications|skills|looking for|stack|опыт|требован|задач|ищем|стек|обязанност|erfahrung|anforderung|aufgaben|kenntnisse|dein profil|ihr profil|expérience|compétences|vos missions|profil recherché|requisitos|experiencia|responsabilidades|experiência|esperienza|requisiti|ervaring|vereisten|wymagania|doświadczenie|obowiązki)/i;

/**
 * Work Finder's rule: a script-rendered page leaves a shell with little
 * text, so text shorter than 250 characters or without any word a vacancy
 * uses (requirements, tasks, stack…) is read in a browser instead.
 */
export function isBrowserOnly(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length < 250 || !vacancyWords.test(trimmed);
}

const challengeMarkers =
  /<title>\s*(?:Just a moment|Attention Required|Access denied|Please Wait|DDoS-Guard|Checking your browser)|challenges\.cloudflare\.com|cf-browser-verification|cf_chl_opt|_cf_chl|px-captcha|captcha-delivery\.com|datadome|hcaptcha\.com|www\.google\.com\/recaptcha|Enable JavaScript and cookies to continue/i;

/** Bot protection (Cloudflare, DataDome, PerimeterX, a CAPTCHA) instead of the page. */
export function isChallenge(response: HttpResponse): boolean {
  if (response.headers["cf-mitigated"] === "challenge") return true;
  if (![200, 202, 401, 403, 429, 503].includes(response.status)) return false;
  return challengeMarkers.test(response.text.slice(0, 20_000));
}

/** Login walls: a sign-in page instead of the vacancy. */
export function isLoginWall(response: HttpResponse): boolean {
  let path = "";
  try {
    path = new URL(response.url).pathname;
  } catch {}
  return /\/(?:login|signin|sign-in|auth|account\/login|uas\/login)\b/i.test(
    path,
  );
}

/** A redirect that dropped the posting's own path (an ID or slug) lands on a list of jobs. */
export function redirectedToList(
  link: string,
  finalUrl: string | null | undefined,
): boolean {
  if (!finalUrl) return false;
  let from: URL;
  let to: URL;
  try {
    from = new URL(link);
    to = new URL(finalUrl);
  } catch {
    return false;
  }
  if (from.hostname.replace(/^www\./, "") !== to.hostname.replace(/^www\./, ""))
    return false;
  const fromParts = from.pathname.split("/").filter(Boolean);
  const toParts = to.pathname.split("/").filter(Boolean);
  const last = fromParts.at(-1);
  return Boolean(
    last &&
      last.length > 3 &&
      !to.pathname.includes(last) &&
      toParts.length < fromParts.length,
  );
}
