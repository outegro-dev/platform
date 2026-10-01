/**
 * A browser and a system named from a User-Agent, each from a fixed list.
 * The header is whatever the client sent, so only these names leave the
 * service that read it (security notices, the session list), never the
 * header itself. Order matters: Edge and Opera also say "Chrome", Chrome
 * also says "Safari", iOS also says "Mac OS X".
 */
export const browsers = [
  "Edge",
  "Opera",
  "Firefox",
  "Chrome",
  "Safari",
] as const;
export const operatingSystems = [
  "iOS",
  "Android",
  "macOS",
  "Windows",
  "Linux",
] as const;
export type Browser = (typeof browsers)[number];
export type OperatingSystem = (typeof operatingSystems)[number];

const browserPatterns: readonly [Browser, RegExp][] = [
  ["Edge", /Edg(e|A|iOS)?\//],
  ["Opera", /OPR\//],
  ["Firefox", /(Firefox|FxiOS)\//],
  ["Chrome", /(Chrome|CriOS)\//],
  ["Safari", /Safari\//],
];
const systemPatterns: readonly [OperatingSystem, RegExp][] = [
  ["iOS", /iPhone|iPad|iPod/],
  ["Android", /Android/],
  ["macOS", /Mac OS X|Macintosh/],
  ["Windows", /Windows/],
  ["Linux", /Linux|X11/],
];

export function deviceOf(userAgent: string | null | undefined): {
  browser: Browser | null;
  os: OperatingSystem | null;
} {
  const ua = userAgent ?? "";
  return {
    browser: browserPatterns.find(([, re]) => re.test(ua))?.[0] ?? null,
    os: systemPatterns.find(([, re]) => re.test(ua))?.[0] ?? null,
  };
}
