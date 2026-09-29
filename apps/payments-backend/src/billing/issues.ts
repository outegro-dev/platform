import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "../common/database.js";
import { reconciliationIssues } from "../db/schema.js";

export type IssueKind =
  | "amount_mismatch"
  | "renewal_without_parent"
  | "unmatched_event"
  | "event_failed"
  | "checkout_unknown"
  | "invoice_missing"
  | "cancel_failed"
  | "period_mismatch"
  | "refund_unmatched"
  | "refund_review"
  | "chargeback_opened"
  | "duplicate_purchase"
  | "renewal_cancel_failed"
  | "renewal_after_revoke";

/**
 * Discrepancies an operator must see (chapter 6.10). One row per subject:
 * a repeat bumps `occurrences` and `lastSeenAt`. The row always shows the
 * subject's latest problem: another kind replaces the old one, and a
 * problem that comes back after it was resolved opens the row again.
 * Evidence holds ids and amounts, never buyer emails.
 */
@Injectable()
export class IssueRegistry {
  async open(
    tx: Executor,
    issue: {
      kind: IssueKind;
      severity: "low" | "medium" | "high";
      subjectKey: string;
      related?: Record<string, unknown>;
      evidence?: Record<string, unknown>;
    },
    at: Date,
  ) {
    await tx
      .insert(reconciliationIssues)
      .values({
        kind: issue.kind,
        severity: issue.severity,
        subjectKey: issue.subjectKey,
        related: issue.related ?? {},
        evidence: issue.evidence ?? {},
        firstSeenAt: at,
        lastSeenAt: at,
      })
      .onConflictDoUpdate({
        target: reconciliationIssues.subjectKey,
        set: {
          kind: sql`excluded.kind`,
          severity: sql`excluded.severity`,
          status: "open",
          related: sql`${reconciliationIssues.related} || excluded.related`,
          evidence: sql`excluded.evidence`,
          // A reopened issue is a new problem in the operator's queue.
          firstSeenAt: sql`case when ${reconciliationIssues.status} = 'resolved' then excluded.first_seen_at else ${reconciliationIssues.firstSeenAt} end`,
          lastSeenAt: at,
          occurrences: sql`${reconciliationIssues.occurrences} + 1`,
          resolvedAt: null,
          resolvedBy: null,
          resolution: null,
        },
      });
  }

  async resolve(
    tx: Executor,
    subjectKey: string,
    input: { actorId: string | null; resolution: string },
    at: Date,
    kind?: IssueKind,
  ) {
    await tx
      .update(reconciliationIssues)
      .set({
        status: "resolved",
        resolvedAt: at,
        resolvedBy: input.actorId,
        resolution: input.resolution,
      })
      .where(
        and(
          eq(reconciliationIssues.subjectKey, subjectKey),
          eq(reconciliationIssues.status, "open"),
          kind ? eq(reconciliationIssues.kind, kind) : undefined,
        ),
      );
  }
}
