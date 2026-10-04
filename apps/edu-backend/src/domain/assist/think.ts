const OPEN = "<think>";
const CLOSE = "</think>";

/** Length of the longest end of `text` that is the start of `tag`. */
function partialTag(text: string, tag: string): number {
  for (let size = Math.min(tag.length - 1, text.length); size > 0; size--)
    if (text.endsWith(tag.slice(0, size))) return size;
  return 0;
}

/**
 * Removes `<think>…</think>` from a streamed answer: some models write their
 * reasoning into the text itself. Tags may arrive split across chunks, so a
 * possible start of a tag is held back until the next chunk decides it. The
 * blank lines a model leaves before the answer proper are dropped too.
 */
export class ThinkFilter {
  private pending = "";
  private thinking = false;
  private started = false;

  /** The visible part of the text so far; may be empty. */
  push(chunk: string): string {
    this.pending += chunk;
    let visible = "";
    for (;;) {
      if (this.thinking) {
        const end = this.pending.indexOf(CLOSE);
        if (end < 0) {
          // Reasoning is dropped; only a possible start of the closing tag stays.
          this.pending = this.pending.slice(
            this.pending.length - partialTag(this.pending, CLOSE),
          );
          break;
        }
        this.pending = this.pending.slice(end + CLOSE.length);
        this.thinking = false;
        continue;
      }
      const start = this.pending.indexOf(OPEN);
      if (start >= 0) {
        visible += this.pending.slice(0, start);
        this.pending = this.pending.slice(start + OPEN.length);
        this.thinking = true;
        continue;
      }
      const keep = partialTag(this.pending, OPEN);
      visible += this.pending.slice(0, this.pending.length - keep);
      this.pending = this.pending.slice(this.pending.length - keep);
      break;
    }
    return this.lead(visible);
  }

  /** What is left at the end: text that only looked like a tag. */
  flush(): string {
    const rest = this.thinking ? "" : this.pending;
    this.pending = "";
    return this.lead(rest);
  }

  private lead(text: string): string {
    if (this.started) return text;
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed) this.started = true;
    return trimmed;
  }
}
