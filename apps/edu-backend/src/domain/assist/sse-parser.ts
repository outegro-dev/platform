export type SseMessage = { readonly event: string; readonly data: string };

/**
 * Server-Sent Events decoding (the WHATWG format): text arrives in arbitrary
 * pieces; `push` returns the messages completed so far. Lines end with LF,
 * CRLF or CR; a blank line ends a message; `data:` lines of one message are
 * joined with LF; comments (`:`) and `id`/`retry` fields are ignored.
 */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];

  push(text: string): SseMessage[] {
    this.buffer += text;
    const messages: SseMessage[] = [];
    for (;;) {
      const end = this.buffer.search(/\r\n|\r|\n/);
      if (end < 0) break;
      // A CR at the very end may be the first half of a CRLF: wait for more.
      if (this.buffer[end] === "\r" && end === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(
        end + (this.buffer.startsWith("\r\n", end) ? 2 : 1),
      );
      const message = this.line(line);
      if (message) messages.push(message);
    }
    return messages;
  }

  /** The last message when the stream ended without its blank line. */
  end(): SseMessage[] {
    const rest = this.buffer;
    this.buffer = "";
    const messages: SseMessage[] = [];
    for (const line of [...rest.split(/\r\n|\r|\n/), ""]) {
      const message = this.line(line);
      if (message) messages.push(message);
    }
    return messages;
  }

  private line(line: string): SseMessage | null {
    if (line === "") {
      if (this.data.length === 0) {
        this.event = "";
        return null;
      }
      const message = {
        event: this.event || "message",
        data: this.data.join("\n"),
      };
      this.event = "";
      this.data = [];
      return message;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    return null;
  }
}
