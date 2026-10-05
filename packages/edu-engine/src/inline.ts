import type { Inline } from "@outegro/contracts/edu";

/*
 * Inline text of a book outside its renderer: where a link may lead, and
 * the words of a fragment for a label (an accessible name, a caption that
 * names a scroll region). `plainText` in text.ts keeps code in backticks
 * for the assistant; a label reads the words only.
 */

/**
 * Where a link in a book may lead: an https page (opened in a new tab) or
 * an anchor on the same page. Anything else (javascript:, data:, http:,
 * protocol-relative, credentials in the URL, whitespace) is not a link.
 */
export function safeHref(
  href: unknown,
): { href: string; external: boolean } | null {
  if (typeof href !== "string" || href.length > 2048) return null;
  if (/^#[A-Za-z][\w-]*$/.test(href)) return { href, external: false };
  if (!href.startsWith("https://") || /[\s\\]/.test(href)) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { href: url.toString(), external: true };
  } catch {
    return null;
  }
}

/** The words of inline text: marks dropped, code as its text, one line. */
export function labelText(nodes: readonly Inline[] | null | undefined): string {
  if (!nodes) return "";
  let text = "";
  for (const node of nodes) {
    if (typeof node === "string") text += node;
    else if (node.t === "code") text += node.v;
    else if (node.t === "br") text += " ";
    else text += labelText(node.c);
  }
  return text.replace(/\s+/g, " ").trim();
}
