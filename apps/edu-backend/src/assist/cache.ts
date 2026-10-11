import { createHash } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { AssistStyle } from "@outegro/contracts/edu";
import {
  CLOCK,
  type Clock,
  DATABASE,
  heldBySafeMode,
} from "@outegro/nest-common";
import { and, eq, ne, notExists, or, sql } from "drizzle-orm";
import type { EduDatabase } from "../common/database.js";
import { loggableError } from "../common/loggable-error.js";
import { assistCache, books } from "../db/schema.js";
import { AssistPrompts } from "../domain/assist/prompts.js";
import { TEXT_MODEL, type TextModel } from "../domain/assist/text-model.js";

const logger = new Logger("Assistant");

/** How often stale answers are looked for again after the sweep at start. */
export const CACHE_SWEEP_INTERVAL_MS = 24 * 3600_000;

/**
 * What of the request decides a style answer, so equal requests share one
 * answer; the model and the prompt revision are the cache's own.
 */
export type CacheKeyParts = {
  readonly bookId: string;
  readonly slug: string;
  readonly contentVersion: number;
  readonly chapter: number;
  readonly section: string;
  readonly style: AssistStyle;
};

/**
 * Answers to "explain this section in style X" for every reader of the same
 * book version, model and prompt revision. Only answers that came in full
 * are kept; a new import (content version), model or prompt wording makes a
 * new key, so stale answers are never served.
 *
 * A sweep drops them when the service starts and once a day after. Each of
 * the three changes comes with a deploy (the import runs in its PreSync
 * Job, the model is the pod's environment, the prompts are code), and the
 * new pod starts after it; the daily pass takes what the previous pod
 * stored while the two overlapped. Current answers do not expire: there is
 * at most one per section and style, and dropping one would only buy it
 * from the provider again.
 */
@Injectable()
export class AssistCache
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TEXT_MODEL) private readonly model: TextModel,
  ) {}

  onApplicationBootstrap() {
    // A timer that deletes data: off until the restored state is checked.
    if (heldBySafeMode("assist-cache-sweep")) return;
    this.timer = setInterval(() => void this.sweep(), CACHE_SWEEP_INTERVAL_MS);
    void this.sweep();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** The cached answer, counted as one more hit; null when there is none. */
  async take(parts: CacheKeyParts): Promise<string | null> {
    const [row] = await this.database.db
      .update(assistCache)
      .set({ hits: sql`${assistCache.hits} + 1` })
      .where(eq(assistCache.key, this.keyOf(parts)))
      .returning({ text: assistCache.text });
    return row?.text ?? null;
  }

  /**
   * Keeps a complete answer; the first one stored for a key stays. A write
   * that fails loses only the shortcut (the reader has the answer already)
   * and is logged by kind of error alone: a failed query carries the answer
   * it tried to store.
   */
  async put(parts: CacheKeyParts, text: string): Promise<void> {
    try {
      await this.database.db
        .insert(assistCache)
        .values({
          key: this.keyOf(parts),
          bookId: parts.bookId,
          contentVersion: parts.contentVersion,
          model: this.model.name,
          promptRevision: AssistPrompts.revision,
          text,
          createdAt: this.clock.now(),
          hits: 0,
        })
        .onConflictDoNothing();
    } catch (error) {
      logger.error({ error: loggableError(error) }, "Answer not cached");
    }
  }

  /**
   * Drops the answers no request can hit any more: of a book version an
   * import has replaced, of another model, of an earlier prompt revision.
   * Returns how many were dropped.
   */
  async prune(): Promise<number> {
    const db = this.database.db;
    const current = db
      .select({ id: books.id })
      .from(books)
      .where(
        and(
          eq(books.id, assistCache.bookId),
          eq(books.contentVersion, assistCache.contentVersion),
        ),
      );
    const dropped = await db
      .delete(assistCache)
      .where(
        or(
          ne(assistCache.model, this.model.name),
          ne(assistCache.promptRevision, AssistPrompts.revision),
          notExists(current),
        ),
      )
      .returning({ key: assistCache.key });
    return dropped.length;
  }

  /** One sweep: a failure is logged, and the next one tries again. */
  private async sweep(): Promise<void> {
    try {
      const dropped = await this.prune();
      if (dropped > 0) logger.log({ dropped }, "Stale answers dropped");
    } catch (error) {
      logger.error({ error: loggableError(error) }, "Cache sweep failed");
    }
  }

  private keyOf(parts: CacheKeyParts): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          AssistPrompts.revision,
          parts.slug,
          parts.contentVersion,
          parts.chapter,
          parts.section,
          parts.style,
          this.model.name,
        ]),
      )
      .digest("hex");
  }
}
