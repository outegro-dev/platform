/*
 * The SVG a book may carry (figures and its cover): one whitelist of
 * elements and attributes for the importer, which keeps only these when it
 * converts a book, and for edu-web, which checks the markup again before
 * injecting it as HTML (defence in depth). Anything else — scripts, event
 * handlers, links, styles, foreign objects, comments — is not book SVG.
 */

/** Elements of book SVG. */
export const svgElements: readonly string[] = Object.freeze([
  "svg",
  "g",
  "defs",
  "marker",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
]);

/** Attributes of book SVG, spelled as SVG spells them (viewBox, refX…). */
export const svgAttributes: readonly string[] = Object.freeze([
  "xmlns",
  "viewBox",
  "preserveAspectRatio",
  "role",
  "aria-label",
  "aria-hidden",
  "focusable",
  "id",
  "class",
  "refX",
  "refY",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "orient",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "dx",
  "dy",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "points",
  "transform",
  "text-anchor",
  "dominant-baseline",
  "marker-start",
  "marker-mid",
  "marker-end",
  "stroke-dasharray",
  "opacity",
]);

const elements = new Set(svgElements);
const attributes = new Set(svgAttributes);
const byLowerCase = new Map(
  svgAttributes.map((name) => [name.toLowerCase(), name]),
);

/** Whether `name` is a whitelisted element (exact, lower-case spelling). */
export function isSvgElement(name: string): boolean {
  return elements.has(name);
}

/**
 * The whitelisted spelling of an attribute whatever its case (an HTML
 * parser lowercases `viewBox` to `viewbox`), or null when it is not allowed.
 */
export function svgAttributeName(name: string): string | null {
  return byLowerCase.get(name.toLowerCase()) ?? null;
}

const localReference = /^url\(#[\w-]+\)$/;

/**
 * Whether an attribute value is harmless: no script or data URL, and
 * `url(…)` only as a reference to an element of the same SVG (`url(#id)`).
 */
export function isSafeSvgValue(value: string): boolean {
  const compact = value.replace(/\s+/g, "").toLowerCase();
  if (compact.includes("javascript:") || compact.includes("data:"))
    return false;
  if (compact.includes("url(")) return localReference.test(value.trim());
  return true;
}

/**
 * Whether one attribute may stay: a whitelisted name in its exact spelling
 * and a harmless value; a marker must point at a marker of the same SVG.
 */
export function isSafeSvgAttribute(name: string, value: string): boolean {
  if (!attributes.has(name) || !isSafeSvgValue(value)) return false;
  if (name.startsWith("marker-")) return localReference.test(value.trim());
  return true;
}

/** True when the markup is one <svg> made only of whitelisted parts. */
export function isSafeSvg(markup: string): boolean {
  const svg = markup.trim();
  if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>")) return false;
  if (/<[!?]/.test(svg)) return false;
  const depth: string[] = [];
  for (const match of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^<>]*)>/g)) {
    const [, closing, name = "", rest = ""] = match;
    if (!elements.has(name)) return false;
    if (closing) {
      if (depth.pop() !== name || rest.trim() !== "") return false;
      continue;
    }
    const selfClosing = rest.trimEnd().endsWith("/");
    const body = selfClosing ? rest.trimEnd().slice(0, -1) : rest;
    let leftover = body;
    for (const attribute of body.matchAll(/\s+([^\s="'/<>]+)="([^"<>]*)"/g)) {
      const [whole, attributeName = "", value = ""] = attribute;
      if (!isSafeSvgAttribute(attributeName, value)) return false;
      leftover = leftover.replace(whole, "");
    }
    if (leftover.trim() !== "") return false;
    if (!selfClosing) depth.push(name);
  }
  // Text between tags may not smuggle markup the scan above did not see.
  const text = svg.replace(/<[^<>]*>/g, "");
  if (/[<>]/.test(text)) return false;
  return depth.length === 0;
}
