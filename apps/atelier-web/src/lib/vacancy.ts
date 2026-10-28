import {
  type AddVacancyRequest,
  addVacancyRequestSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";

/*
 * The one field of "Add a vacancy": a link or the pasted text. What it holds
 * decides the request (`url` or `text`), and every way it can be wrong has
 * its own message.
 */

export const TEXT_MIN = 100;
export const TEXT_MAX = 200_000;

export type VacancyInput =
  | { kind: "empty" }
  | { kind: "url"; url: string; host: string }
  | { kind: "bad-url" }
  | { kind: "text"; text: string; length: number }
  | { kind: "short"; length: number }
  | { kind: "long"; length: number };

const httpUrl = z.url({ protocol: /^https?$/, hostname: z.regexes.domain });

/** What the field holds, as the form reads it. */
export function readVacancyInput(raw: string): VacancyInput {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  const oneToken = !/\s/.test(value);
  const hasScheme = /^https?:\/\//i.test(value);
  const looksLikeLink =
    hasScheme ||
    (oneToken && /^(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(value));
  if (looksLikeLink) {
    if (!oneToken) return { kind: "bad-url" };
    const parsed = httpUrl.safeParse(hasScheme ? value : `https://${value}`);
    if (!parsed.success) return { kind: "bad-url" };
    return {
      kind: "url",
      url: parsed.data,
      host: new URL(parsed.data).hostname.replace(/^www\./, ""),
    };
  }
  const length = [...value].length;
  if (length < TEXT_MIN) return { kind: "short", length };
  if (length > TEXT_MAX) return { kind: "long", length };
  return { kind: "text", text: value, length };
}

/** The request for a valid input, checked with the contract; null otherwise. */
export function vacancyRequest(input: VacancyInput): AddVacancyRequest | null {
  const body =
    input.kind === "url"
      ? { url: input.url }
      : input.kind === "text"
        ? { text: input.text }
        : null;
  if (!body) return null;
  const parsed = addVacancyRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
