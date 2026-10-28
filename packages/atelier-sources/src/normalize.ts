import type { Salary } from "@outegro/contracts/atelier";

/**
 * Any date a provider gives (epoch ms, ISO with an offset, a plain date) as
 * `YYYY-MM-DDTHH:mm:ss.sssZ`, the form the contract accepts; `null` when it
 * is not a plausible date.
 */
export function toIsoUtc(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  let date: Date;
  if (typeof value === "number") date = new Date(value);
  else if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) date = new Date(`${text}T00:00:00Z`);
    else if (/^\d{10,13}$/.test(text))
      date = new Date(Number(text) * (text.length === 10 ? 1000 : 1));
    else
      date = new Date(
        // Microseconds ("…53.000000Z") are cut to milliseconds.
        text.replace(/(\.\d{3})\d+/, "$1"),
      );
  } else return null;
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return date.toISOString();
}

const periodOf = (value: unknown): Salary["period"] | null => {
  const text = String(value ?? "").toLowerCase();
  if (/hour|hr\b|wage/.test(text)) return "hour";
  if (/month|mo\b|мес/.test(text)) return "month";
  if (/year|annual|annum|yr\b|год/.test(text)) return "year";
  return null;
};

const amount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[\s,_]/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
};

/** A salary from provider parts; `null` without an amount or currency. */
export function toSalary(
  min: unknown,
  max: unknown,
  currency: unknown,
  period: unknown,
  defaultPeriod: Salary["period"] | null = null,
): Salary | null {
  let low = amount(min);
  let high = amount(max);
  if (low === 0 && high === 0) return null;
  if (low === 0 && high !== null) low = null;
  if (low === null && high === null) return null;
  if (low !== null && high !== null && low > high) [low, high] = [high, low];
  const code = String(currency ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z$€£₽₾]{1,8}$/.test(code)) return null;
  const resolved = periodOf(period) ?? defaultPeriod;
  if (!resolved) return null;
  return { min: low, max: high, currency: code, period: resolved };
}

const remoteWords =
  /\b(?:remote|telecommut\w*|work from (?:home|anywhere)|wfh|anywhere|distributed)\b|удал[её]н[а-яё]*|удаленк[а-яё]*/i;
const onsiteWords =
  /\b(?:on-?site|in[- ]office|office[- ]based|hybrid)\b|офис[а-яё]*|гибрид[а-яё]*/i;

/**
 * Remote from what a provider says about the place: an explicit flag wins,
 * then the workplace type (hybrid is not remote), then the location text.
 */
export function toRemote(input: {
  flag?: boolean | null;
  workplace?: string | null;
  location?: string | null;
}): boolean | null {
  const workplace = (input.workplace ?? "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  const location = input.location ?? "";
  if (workplace) {
    if (/remote|telecommute|anywhere/.test(workplace)) return true;
    if (/onsite|office|inperson/.test(workplace)) return false;
    // Boards default to "hybrid" while the location says "Remote - Europe".
    if (/hybrid/.test(workplace)) return remoteWords.test(location);
  }
  if (input.flag === true) return true;
  if (remoteWords.test(location)) return true;
  if (onsiteWords.test(location)) return false;
  if (input.flag === false) return false;
  return null;
}

/** "acme-labs" → "Acme Labs": a readable name when a provider gives only a slug. */
export function prettySlug(slug: string): string {
  const words = decodeURIComponent(slug)
    .replace(/\.(com|io|ai|co|dev|app)$/i, "")
    .split(/[-_.\s]+/)
    .filter(Boolean);
  const name = words
    .map((word) =>
      /^[A-Z]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
  return name || slug;
}

export const joinParts = (...parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");

export const joinInline = (...parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" · ");

export const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const clip = (value: string | null, max: number): string | null =>
  value === null ? null : value.length > max ? value.slice(0, max) : value;
