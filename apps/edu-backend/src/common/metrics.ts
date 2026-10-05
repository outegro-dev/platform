import { Injectable } from "@nestjs/common";
import type { ChapterAccess } from "@outegro/contracts/edu";
import { type Counter, Metrics } from "@outegro/nest-common";

export type ProgressKind = "exercise" | "card" | "position" | "understanding";
export type AssistKindLabel = "explain" | "understanding" | "sql_hint";
/**
 * How an assistant request ended. Served: `ok`, `cached`; broken off or not
 * answered by the provider: `failed`, `refused`; the reader left (while
 * waiting for a model slot or during the answer): `aborted`; refused before
 * the model was asked: `disabled`, `daily_limit`, `paused` (all readers'
 * answers for the day are spent), `busy`.
 */
export type AssistOutcomeLabel =
  | "ok"
  | "cached"
  | "failed"
  | "refused"
  | "aborted"
  | "disabled"
  | "daily_limit"
  | "paused"
  | "busy";

/** Education metrics: who gets chapters, who meets the paywall, what readers save. */
@Injectable()
export class EduMetrics {
  private readonly chapters: Counter<"access">;
  private readonly writes: Counter<"kind">;
  private readonly assistRequests: Counter<"kind" | "outcome">;
  private readonly assistTokens: Counter<"direction">;

  constructor(metrics: Metrics) {
    this.chapters = metrics.counter({
      name: "edu_chapter_requests_total",
      help: "Chapter and preface requests by the reader's access: open, preview, granted and staff are served, sign_in (401) and locked (403) are refused.",
      labelNames: ["access"],
    });
    this.writes = metrics.counter({
      name: "edu_progress_writes_total",
      help: "Saved progress by kind: exercise attempts, card marks, reading positions, understanding scores.",
      labelNames: ["kind"],
    });
    this.assistRequests = metrics.counter({
      name: "edu_assist_requests_total",
      help: "Assistant requests by kind (explain, understanding, sql_hint) and outcome: ok, cached, failed, refused (the provider gave nothing), aborted (the reader left), disabled, daily_limit, paused (the day's answers of all readers are spent), busy.",
      labelNames: ["kind", "outcome"],
    });
    this.assistTokens = metrics.counter({
      name: "edu_assist_tokens_total",
      help: "Model tokens the assistant spent, by direction: in (prompt) and out (answer).",
      labelNames: ["direction"],
    });
  }

  chapterRequested(access: ChapterAccess) {
    this.chapters.inc({ access });
  }

  progressSaved(kind: ProgressKind) {
    this.writes.inc({ kind });
  }

  assistRequest(kind: AssistKindLabel, outcome: AssistOutcomeLabel) {
    this.assistRequests.inc({ kind, outcome });
  }

  assistTokensSpent(tokensIn: number, tokensOut: number) {
    if (tokensIn > 0) this.assistTokens.inc({ direction: "in" }, tokensIn);
    if (tokensOut > 0) this.assistTokens.inc({ direction: "out" }, tokensOut);
  }
}
