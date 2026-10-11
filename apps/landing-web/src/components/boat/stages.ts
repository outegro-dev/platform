export type Backdrop = "sky" | "road" | "sea" | "deep";
export type Vehicle =
  | "plane"
  | "car"
  | "ship"
  | "sub"
  | "bus"
  | "truck"
  | "pigeon";

/**
 * The sets of the strip in page order: a backdrop and who rides it. The
 * order decides which side a new set slides in from.
 */
export const STAGES = {
  cover: { backdrop: "sky", vehicle: "plane" },
  contents: { backdrop: "road", vehicle: "car" },
  battle: { backdrop: "sea", vehicle: "ship" },
  platform: { backdrop: "deep", vehicle: "sub" },
  ads: { backdrop: "road", vehicle: "bus" },
  deals: { backdrop: "road", vehicle: "truck" },
  post: { backdrop: "sky", vehicle: "pigeon" },
  // the end of the issue: the ship comes home to the pier
  pier: { backdrop: "sea", vehicle: "ship" },
} as const satisfies Record<string, { backdrop: Backdrop; vehicle: Vehicle }>;

export type Stage = keyof typeof STAGES;

export const STAGE_ORDER = Object.keys(STAGES) as Stage[];

/**
 * Sections in page order and the set each one calls for; "aside" hides the
 * strip (the paper cartoon has its own sea). Matched by selector, so a
 * missing section is just skipped.
 */
export const SECTIONS: readonly (readonly [string, Stage | "aside"])[] = [
  ["#top", "cover"],
  [".toc", "contents"],
  ["#projects", "battle"],
  ["#platform", "platform"],
  ["#services", "ads"],
  ["#process", "aside"],
  ["#engagement", "deals"],
  ["#faq", "post"],
  ["#contact", "post"],
];
