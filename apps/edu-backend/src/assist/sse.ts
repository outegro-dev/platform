import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AssistEvent } from "@outegro/contracts/edu";
import type { Response } from "express";
import { loggableError } from "../common/loggable-error.js";
import type { AssistAnswer } from "./answers.js";
import { ASSIST_TIMING, type AssistTiming } from "./settings.js";

/** Aborted when the client goes away before the response is complete. */
export function hangUpSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

/**
 * One Server-Sent Events response: every event is one `data: <JSON>` line
 * and a blank line; a `: keep-alive` comment goes out every so often until
 * the first words, so proxies do not close a quiet connection.
 */
export class SseChannel {
  private keepAlive: NodeJS.Timeout | undefined;

  constructor(
    private readonly res: Response,
    keepAliveMs: number,
  ) {
    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();
    this.keepAlive = setInterval(
      () => this.write(": keep-alive\n\n"),
      keepAliveMs,
    );
  }

  send(event: AssistEvent) {
    if (event.type === "text") this.stopKeepAlive();
    this.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  end() {
    this.stopKeepAlive();
    if (!this.res.writableEnded) this.res.end();
  }

  private write(chunk: string) {
    if (!this.res.writableEnded && !this.res.destroyed) this.res.write(chunk);
  }

  private stopKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
  }
}

/** Streams a prepared answer as Server-Sent Events and ends the response. */
@Injectable()
export class SseResponder {
  private readonly logger = new Logger("Assistant");

  constructor(@Inject(ASSIST_TIMING) private readonly timing: AssistTiming) {}

  async respond(
    res: Response,
    answer: AssistAnswer,
    signal: AbortSignal,
  ): Promise<void> {
    let channel: SseChannel | undefined;
    try {
      channel = new SseChannel(res, this.timing.keepAliveMs);
      const open = channel;
      await answer.stream((event) => open.send(event), signal);
    } catch (error) {
      // answer.stream never throws; this is the response itself failing.
      this.logger.error(
        { error: loggableError(error) },
        "Assistant response failed",
      );
    } finally {
      await answer.dispose();
      channel?.end();
      if (!channel && !res.headersSent) res.status(500).end();
    }
  }
}
