import { plainText, wordCount } from "./text.js";
import type { Variant } from "./types.js";

/*
 * Shorter forms of a bullet for fitting. The composition writes only the full
 * text; compact and minimal come from the bank when the full text still says
 * what the bank says, otherwise they are cut from the full text at clause
 * boundaries, and the bank's own forms are the last resort.
 */

const filler = new Set(
  "with from that this into over across their which while using used were have been more than also when where them they then each such only very within about after before under".split(
    " ",
  ),
);

/** Lower-case words of four or more letters that carry meaning. */
function contentWords(text: string) {
  return new Set(
    (
      plainText(text)
        .toLowerCase()
        .match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? []
    )
      .map((word) => word.replace(/[.-]+$/, ""))
      .filter((word) => word.length >= 4 && !filler.has(word)),
  );
}

/**
 * The adapted text keeps the bank's meaning when at least half of the bank
 * text's content words are still in it; its short forms then stay valid.
 */
export function keepsBankMeaning(text: string, bankFull: string) {
  const bank = contentWords(bankFull);
  if (!bank.size) return true;
  const adapted = contentWords(text);
  let kept = 0;
  for (const word of bank) if (adapted.has(word)) kept++;
  return kept / bank.size >= 0.5;
}

/** Clause starts a bullet can be cut before: ", which", "; ", " - ", ", reducing" … */
const boundary =
  /(?:;\s+|\s+-\s+|,\s+(?=(?:which|while|so|with|by|using|including|reducing|cutting|making|enabling|resulting|keeping|allowing|letting|giving|turning|bringing|helping|saving|and then|then|to)\b))/giu;

/**
 * The first clauses of a sentence within `ratio` of its words, ending with a
 * full stop and balanced highlights; null when no cut makes it shorter or the
 * cut leaves fewer than six words.
 */
export function shortenSentence(text: string, ratio: number): string | null {
  const total = wordCount(text);
  const target = Math.max(6, Math.ceil(total * ratio));
  const cuts: number[] = [];
  for (const match of text.matchAll(boundary)) {
    const at = match.index ?? 0;
    // Never cut inside a highlighted span.
    const before = text.slice(0, at).split("**").length - 1;
    if (before % 2 === 0) cuts.push(at);
  }
  let best: string | null = null;
  for (const at of cuts) {
    const head = text.slice(0, at).replace(/[\s,;:-]+$/, "");
    const words = wordCount(head);
    if (words < 6) continue;
    if (words > target) break;
    best = head;
  }
  if (!best) return null;
  let result = `${best.replace(/[.!?]+$/, "")}.`;
  if ((result.split("**").length - 1) % 2 === 1)
    result = result.replace(/\*\*(?!.*\*\*)/, "");
  return wordCount(result) < total ? result : null;
}

/** compact never longer than full, minimal never longer than compact. */
export function progressive(variants: Record<Variant, string>) {
  const result = { ...variants };
  if (wordCount(result.compact) > wordCount(result.full))
    result.compact = result.full;
  if (wordCount(result.minimal) > wordCount(result.compact))
    result.minimal = result.compact;
  return result;
}

/**
 * The three forms of a bullet whose full text is `full`: the bank's short
 * forms when the full text keeps the bank's meaning, else forms cut from the
 * full text, else the bank's forms (else the full text itself).
 */
export function bulletVariants(
  full: string,
  bank: Record<Variant, string> | null,
): Record<Variant, string> {
  if (bank && (full === bank.full || keepsBankMeaning(full, bank.full)))
    return progressive({ full, compact: bank.compact, minimal: bank.minimal });
  const compact = shortenSentence(full, 0.75) ?? bank?.compact ?? full;
  // When both targets land on the same cut, the minimal form cuts the compact one again.
  const cut = shortenSentence(full, 0.55);
  const minimal =
    (cut === compact ? shortenSentence(compact, 0.75) : cut) ??
    cut ??
    bank?.minimal ??
    compact;
  return progressive({ full, compact, minimal });
}
