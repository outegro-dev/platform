import { Injectable } from "@nestjs/common";
import type {
  AssistExplain,
  AssistSqlHint,
  AssistStatus,
  AssistUnderstanding,
  Chapter,
  ChapterAccess,
} from "@outegro/contracts/edu";
import { AppError } from "@outegro/nest-common";
import { type BookRow, CatalogService } from "../books/catalog.service.js";
import { EduMetrics } from "../common/metrics.js";
import { findExercise } from "../content/outline.js";
import { isReadable, type Viewer } from "../domain/access.js";
import { AssistPrompts, type Prompt } from "../domain/assist/prompts.js";
import { understandingScore } from "../domain/assist/score.js";
import type { TextRequest } from "../domain/assist/text-model.js";
import { ProgressService } from "../progress/progress.service.js";
import { type AssistAnswer, AssistAnswers } from "./answers.js";
import { AssistCache } from "./cache.js";
import { type AssistJob, AssistLedger } from "./ledger.js";
import { AssistSettings } from "./settings.js";

/**
 * Room for the model's reasoning on top of the answer's own limit when it
 * thinks first: thinking tokens count against max_tokens, and must not cut
 * off the score line that closes an understanding check.
 */
export const THINKING_HEADROOM = 2048;

/**
 * The reading assistant: "explain it differently", "explain it in your own
 * words" and the SQL task hint. Everything a request could be refused for
 * is checked before the answer starts, so refusals are ordinary JSON
 * errors: the reader (401, 403 suspended), the book, chapter, section or
 * task (404), access to the chapter as for reading it (401/403), the
 * assistant being on (503), the reader's daily limit (429), the day's cap of
 * all readers (503 paused) and a free model slot (503). The prompt carries
 * only the book's own text and the reader's words as data; the answer
 * streams afterwards.
 */
@Injectable()
export class AssistService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly progress: ProgressService,
    private readonly settings: AssistSettings,
    private readonly ledger: AssistLedger,
    private readonly cache: AssistCache,
    private readonly answers: AssistAnswers,
    private readonly prompts: AssistPrompts,
    private readonly metrics: EduMetrics,
  ) {}

  async status(viewer: Viewer): Promise<AssistStatus> {
    const userId = this.reader(viewer);
    return {
      enabled: this.settings.enabled,
      dailyLimit: this.settings.dailyLimit,
      usedToday: await this.ledger.usedToday(userId),
    };
  }

  /** A section another way: style answers are shared through the cache. */
  async explain(
    viewer: Viewer,
    slug: string,
    body: AssistExplain,
    signal: AbortSignal,
  ): Promise<AssistAnswer> {
    const userId = this.reader(viewer);
    const { book, chapter } = await this.openChapter(
      viewer,
      slug,
      body.chapter,
    );
    const prompt = this.prompts.explain({
      book: { slug: book.slug, title: book.title },
      chapter,
      section: body.section,
      ...(body.style === undefined ? {} : { style: body.style }),
      ...(body.question === undefined ? {} : { question: body.question }),
      ...(body.avoid === undefined ? {} : { avoid: body.avoid }),
    });
    if (!prompt) throw new AppError("NOT_FOUND");
    const job = this.job("explain", userId, book, chapter.n);
    this.requireEnabled(job);
    const served = () => this.progress.recordActivity(userId, book.id);
    // A question or "another version" is the reader's own: never shared.
    const cacheKey =
      body.style !== undefined && body.avoid === undefined
        ? this.cache.keyOf({
            slug: book.slug,
            contentVersion: book.contentVersion,
            chapter: chapter.n,
            section: body.section,
            style: body.style,
            model: this.answers.modelName,
          })
        : null;
    if (cacheKey) {
      const cached = await this.cache.take(cacheKey);
      if (cached !== null) return this.answers.cached(job, cached, served);
    }
    return this.answers.fromModel(
      job,
      this.request(prompt),
      signal,
      async (result) => {
        if (cacheKey && !result.truncated)
          await this.cache.put(cacheKey, result.text);
        await served();
        return null;
      },
    );
  }

  /** A retelling of a chapter, graded; the best grade goes to progress. */
  async understanding(
    viewer: Viewer,
    slug: string,
    body: AssistUnderstanding,
    signal: AbortSignal,
  ): Promise<AssistAnswer> {
    const userId = this.reader(viewer);
    const { book, chapter } = await this.openChapter(
      viewer,
      slug,
      body.chapter,
    );
    const job = this.job("understanding", userId, book, chapter.n);
    this.requireEnabled(job);
    const prompt = this.prompts.understanding({
      book: { slug: book.slug, title: book.title },
      chapter,
      text: body.text,
    });
    // Grading and SQL hints think first (accuracy over speed: a wrong fact
    // or a full solution there costs the reader more); explanations answer
    // at once.
    return this.answers.fromModel(
      job,
      this.request(prompt, true),
      signal,
      async (result) => {
        const score = understandingScore(result.text);
        if (score === null) await this.progress.recordActivity(userId, book.id);
        else
          await this.progress.recordUnderstanding(
            userId,
            book.id,
            chapter.n,
            score,
          );
        return score;
      },
    );
  }

  /** What is wrong with the reader's query; the solution stays with the model. */
  async sqlHint(
    viewer: Viewer,
    slug: string,
    body: AssistSqlHint,
    signal: AbortSignal,
  ): Promise<AssistAnswer> {
    const userId = this.reader(viewer);
    const { book, policy } = await this.catalog.visible(slug, viewer);
    const entry = (await this.catalog.outline(book.id)).find((chapter) =>
      chapter.exerciseIds.includes(body.exerciseId),
    );
    if (!entry) throw new AppError("NOT_FOUND");
    this.requireReadable(policy.chapter(viewer, entry.n));
    const document = await this.catalog.document(book.id, entry.n);
    const task = document
      ? findExercise(document.blocks, body.exerciseId)
      : null;
    // Another kind of exercise is not an SQL task with this id.
    if (task?.t !== "sqlTask") throw new AppError("NOT_FOUND");
    const job = this.job("sql_hint", userId, book, entry.n);
    this.requireEnabled(job);
    const prompt = this.prompts.sqlHint({
      book: { slug: book.slug, title: book.title },
      task,
      sql: body.sql,
      problem: body.problem,
      ...(body.detail === undefined ? {} : { detail: body.detail }),
      ...(body.mine === undefined ? {} : { mine: body.mine }),
    });
    return this.answers.fromModel(
      job,
      this.request(prompt, true),
      signal,
      async () => {
        await this.progress.recordActivity(userId, book.id);
        return null;
      },
    );
  }

  private reader(viewer: Viewer): string {
    if (!viewer.userId) throw new AppError("UNAUTHENTICATED");
    return viewer.userId;
  }

  private job(
    kind: AssistJob["kind"],
    userId: string,
    book: BookRow,
    chapter: number,
  ): AssistJob {
    return { kind, userId, bookId: book.id, chapter };
  }

  private request(prompt: Prompt, thinking = false): TextRequest {
    return {
      ...prompt,
      thinking,
      maxTokens: this.settings.maxTokens + (thinking ? THINKING_HEADROOM : 0),
    };
  }

  /** The chapter's document if the reader may read it now (the reading rules). */
  private async openChapter(
    viewer: Viewer,
    slug: string,
    n: number,
  ): Promise<{ book: BookRow; chapter: Chapter }> {
    const { book, policy } = await this.catalog.visible(slug, viewer);
    const outline = await this.catalog.outline(book.id);
    if (!outline.some((chapter) => chapter.n === n))
      throw new AppError("NOT_FOUND");
    this.requireReadable(policy.chapter(viewer, n));
    const chapter = await this.catalog.document(book.id, n);
    // Replaced by an import between the two reads.
    if (!chapter) throw new AppError("NOT_FOUND");
    return { book, chapter };
  }

  /** 401 when the reader must sign in first, 403 when the chapter is closed. */
  private requireReadable(access: ChapterAccess) {
    if (access === "sign_in")
      throw new AppError("UNAUTHENTICATED", {
        fieldErrors: { access: [access] },
      });
    if (!isReadable(access))
      throw new AppError("FORBIDDEN", { fieldErrors: { access: [access] } });
  }

  /** 503 while the assistant is off (no key, turned off, SAFE_MODE). */
  private requireEnabled(job: AssistJob) {
    if (this.settings.enabled) return;
    this.metrics.assistRequest(job.kind, "disabled");
    throw new AppError("DEPENDENCY_UNAVAILABLE", {
      fieldErrors: { assist: ["disabled"] },
      retryable: false,
    });
  }
}
