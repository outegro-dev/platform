import { randomBytes } from "node:crypto";
import type { CvRole } from "@outegro/contracts/atelier";

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * 12 characters of base62 from the CSPRNG (~71 bits). Rejection sampling
 * keeps every character equally likely (248 = 4 · 62).
 */
export function linkHash(length = 12): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue;
      out += base62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export const isLinkHash = (value: string) => /^[0-9A-Za-z]{12}$/.test(value);

/** Letters, digits and hyphens of a name part; accents dropped (José → Jose). */
function part(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join("_");
}

/** `Senior Backend Engineer` from cvRole; `Software Engineer` without one. */
export function roleWords(role: CvRole | null | undefined) {
  if (!role) return "Software Engineer";
  return `${role.senior ? "Senior " : ""}${role.focus} ${role.noun}`;
}

/**
 * The name a recruiter's download gets: First_Last_Role_Words_CV.pdf, e.g.
 * `Alex_Example_Senior_Backend_Engineer_CV.pdf`.
 */
export function cvFileName(
  person: { firstName: string; lastName: string },
  role: CvRole | null | undefined,
) {
  const name = [
    part(person.firstName),
    part(person.lastName),
    part(roleWords(role)),
  ]
    .filter(Boolean)
    .join("_");
  return `${name || "CV"}_CV.pdf`.replace(/^CV_CV/, "CV");
}

const botPattern = new RegExp(
  [
    "TelegramBot",
    "Slackbot",
    "Slack-ImgProxy",
    "LinkedInBot",
    "GoogleImageProxy",
    "facebookexternalhit",
    "Facebot",
    "WhatsApp",
    "Twitterbot",
    "Discordbot",
    "SkypeUriPreview",
    "redditbot",
    "Applebot",
    "bingbot",
    "Googlebot",
    "bot\\b",
    "crawler",
    "spider",
    "preview",
    "HeadlessChrome",
    "curl/",
    "wget/",
    "python-requests",
  ].join("|"),
  "i",
);

/** Link previews, crawlers and scripts do not count as a recruiter opening the CV. */
export function isBot(userAgent: string | undefined | null) {
  if (!userAgent?.trim()) return true;
  return botPattern.test(userAgent);
}

/** `inline` or `attachment` with an ASCII file name and its RFC 5987 twin. */
export function contentDisposition(
  kind: "inline" | "attachment",
  fileName: string,
) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
