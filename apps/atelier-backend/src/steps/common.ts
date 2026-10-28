import type { CvDocument } from "@outegro/contracts/atelier";
import { z } from "zod";

/** An engine value passed between steps as plain JSON (checked by the engine). */
export const json = <T>(name: string) =>
  z.custom<T>(
    (value) => value !== null && typeof value === "object",
    `${name} must be an object`,
  );

/** The answer of an engine prompt is either the list or `{ <key>: list }`. */
export function listOf<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>)[key])
  )
    return (value as Record<string, T[]>)[key] as T[];
  throw new Error(`expected a list of ${key}`);
}

/** The CV as a reader (and an ATS parser) gets it, in reading order. */
export function cvText(document: CvDocument): string {
  const lines = [
    document.name,
    document.headline,
    document.stack,
    document.location,
    ...document.summary,
    ...document.skills.map((row) => `${row.label}: ${row.items.join(", ")}`),
    ...document.jobs.flatMap((job) => [
      `${job.title} ${job.company} ${job.dates} ${job.location}`,
      job.description,
      ...job.bullets.map((bullet) => bullet.text),
    ]),
    ...document.education.map(
      (item) => `${item.degree} ${item.school} ${item.dates}`,
    ),
    ...document.languages.map((item) => `${item.name} ${item.level}`),
  ];
  return lines.filter(Boolean).join("\n").replace(/\*\*/g, "");
}

const atsHosts: {
  ats: "ashby" | "lever" | "greenhouse" | "workable";
  host: RegExp;
}[] = [
  { ats: "ashby", host: /(^|\.)ashbyhq\.com$/ },
  { ats: "lever", host: /(^|\.)lever\.co$/ },
  { ats: "greenhouse", host: /(^|\.)greenhouse\.io$/ },
  { ats: "workable", host: /(^|\.)workable\.com$/ },
];

/** The ATS a form adapter exists for, from the URL's host. */
export function formAtsOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return atsHosts.find((item) => item.host.test(host))?.ats ?? null;
  } catch {
    return null;
  }
}
