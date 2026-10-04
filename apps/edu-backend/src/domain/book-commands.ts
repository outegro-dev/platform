import { isDeepStrictEqual } from "node:util";
import type {
  AccessRule,
  BookStatus,
  EduAuditAction,
} from "@outegro/contracts/edu";

/**
 * Two rules open a book to the same readers: the same mode and, for paid
 * books, the same preview and the same features in any order (the features
 * are a set: one grant of any of them opens the book).
 */
export function sameRule(a: AccessRule, b: AccessRule): boolean {
  if (a.mode !== "grant" || b.mode !== "grant") return a.mode === b.mode;
  const features = (rule: { features: readonly string[] }) =>
    [...new Set(rule.features)].sort();
  return (
    a.previewChapters === b.previewChapters &&
    isDeepStrictEqual(features(a), features(b))
  );
}

/** The book as it is refuses the command: 422 on `field` with `reason`. */
export class CommandRefused extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
    this.name = "CommandRefused";
  }
}

/** What a command changes in the book, and what its audit row records. */
export type BookChange = {
  readonly action: EduAuditAction;
  readonly set: {
    readonly status?: BookStatus;
    readonly publishedAt?: Date;
    readonly rule?: AccessRule;
  };
  readonly data: Record<string, unknown>;
};

/**
 * The rules of the admin console's book commands, apart from storage: a
 * command must change something (a rule is compared as `sameRule` does),
 * publishing stamps the time, and a preview cannot cover more chapters than
 * the book has. Versions, locking and the audit row stay with the caller.
 */
export class BookCommands {
  setStatus(
    book: { readonly status: BookStatus },
    status: BookStatus,
    now: Date,
  ): BookChange {
    if (book.status === status) throw new CommandRefused("status", "unchanged");
    return {
      action: "book.status.changed",
      set: { status, ...(status === "published" ? { publishedAt: now } : {}) },
      data: { before: { status: book.status }, after: { status } },
    };
  }

  setAccess(
    book: { readonly rule: AccessRule },
    rule: AccessRule,
    chapters: number,
  ): BookChange {
    if (sameRule(book.rule, rule))
      throw new CommandRefused("rule", "unchanged");
    if (rule.mode === "grant" && rule.previewChapters > chapters)
      throw new CommandRefused(
        "rule.previewChapters",
        "more than the chapters",
      );
    return {
      action: "book.access.changed",
      set: { rule },
      data: { before: { rule: book.rule }, after: { rule } },
    };
  }
}
