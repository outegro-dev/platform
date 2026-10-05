import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AssistStyle } from "@outegro/contracts/edu";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { eq, sql } from "drizzle-orm";
import type { EduDatabase } from "../common/database.js";
import { loggableError } from "../common/loggable-error.js";
import { assistCache } from "../db/schema.js";
import { AssistPrompts } from "../domain/assist/prompts.js";

const logger = new Logger("Assistant");

/** What decides a style answer, so equal requests share one answer. */
export type CacheKeyParts = {
  readonly slug: string;
  readonly contentVersion: number;
  readonly chapter: number;
  readonly section: string;
  readonly style: AssistStyle;
  readonly model: string;
};

/**
 * Answers to "explain this section in style X" for every reader of the same
 * book version, model and prompt revision. Only answers that came in full
 * are kept; a new import (content version), model or prompt wording makes a
 * new key, so stale answers are never served.
 */
@Injectable()
export class AssistCache {
  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  keyOf(parts: CacheKeyParts): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          AssistPrompts.revision,
          parts.slug,
          parts.contentVersion,
          parts.chapter,
          parts.section,
          parts.style,
          parts.model,
        ]),
      )
      .digest("hex");
  }

  /** The cached answer, counted as one more hit; null when there is none. */
  async take(key: string): Promise<string | null> {
    const [row] = await this.database.db
      .update(assistCache)
      .set({ hits: sql`${assistCache.hits} + 1` })
      .where(eq(assistCache.key, key))
      .returning({ text: assistCache.text });
    return row?.text ?? null;
  }

  /**
   * Keeps a complete answer; the first one stored for a key stays. A write
   * that fails loses only the shortcut (the reader has the answer already)
   * and is logged by kind of error alone: a failed query carries the answer
   * it tried to store.
   */
  async put(key: string, text: string): Promise<void> {
    try {
      await this.database.db
        .insert(assistCache)
        .values({ key, text, createdAt: this.clock.now(), hits: 0 })
        .onConflictDoNothing();
    } catch (error) {
      logger.error({ error: loggableError(error) }, "Answer not cached");
    }
  }
}
