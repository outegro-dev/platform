import { permissionsOf } from "@outegro/contracts/access";
import {
  type AccessRule,
  type BookAccess,
  type BookStatus,
  type ChapterAccess,
  type readerAccessSchema,
} from "@outegro/contracts/edu";
import { readableAccess } from "@outegro/edu-engine";
import type { z } from "zod";

export type ReaderAccess = z.infer<typeof readerAccessSchema>;

/** A grant as projected from `billing.grant.changed.v1`. */
export type GrantRecord = {
  readonly feature: string;
  readonly state: "active" | "revoked" | "expired";
  readonly validFrom: Date;
  /** null only for an explicitly perpetual grant. */
  readonly validUntil: Date | null;
};

/**
 * In force: active and inside [validFrom, validUntil), validUntil null
 * meaning perpetual. Checked at the moment of use, so expiry needs no cron
 * (INV-12).
 */
export function grantInForce(grant: GrantRecord, now: Date): boolean {
  return (
    grant.state === "active" &&
    grant.validFrom.getTime() <= now.getTime() &&
    (grant.validUntil === null || grant.validUntil.getTime() > now.getTime())
  );
}

/**
 * Who is reading: signed in or not, staff, and the features of the edu grants
 * in force. Staff comes from platform roles (`edu.read`) only; a paid grant
 * never makes anyone staff (INV-08).
 */
export class Viewer {
  private constructor(
    /** The token's subject; null when signed out. */
    readonly userId: string | null,
    readonly staff: boolean,
    readonly features: ReadonlySet<string>,
  ) {}

  static anonymous(): Viewer {
    return new Viewer(null, false, new Set());
  }

  static of(input: {
    userId: string;
    roles: readonly string[];
    grants: readonly GrantRecord[];
    now: Date;
  }): Viewer {
    return new Viewer(
      input.userId,
      permissionsOf(input.roles).has("edu.read"),
      new Set(
        input.grants
          .filter((grant) => grantInForce(grant, input.now))
          .map((grant) => grant.feature),
      ),
    );
  }

  get signedIn(): boolean {
    return this.userId !== null;
  }

  /** A grant in force covers one of `features`. */
  holdsAny(features: readonly string[]): boolean {
    return features.some((feature) => this.features.has(feature));
  }
}

export const isReadable = (access: ChapterAccess): boolean =>
  readableAccess.includes(access);

/**
 * What one access-rule mode means for a reader who is not staff. A new mode
 * is a new strategy in RULE_MODES; BookPolicy does not change.
 */
export interface RuleMode {
  /** Access to chapter `n`. */
  chapter(viewer: Viewer, n: number): ChapterAccess;
  /** Access to the book as a whole: the library card. */
  book(viewer: Viewer): BookAccess;
  /** A signed-in reader with these features in force (the admin console). */
  reader(features: ReadonlySet<string>): ReaderAccess;
  /** Features that unlock the book; none for books that are not paid. */
  readonly features: readonly string[];
  readonly previewChapters: number;
}

/** Everyone reads, signed in or not. */
class FreeMode implements RuleMode {
  readonly features = [];
  readonly previewChapters = 0;
  chapter(): ChapterAccess {
    return "open";
  }
  book(): BookAccess {
    return "open";
  }
  reader(): ReaderAccess {
    return "open";
  }
}

/** Every signed-in reader reads. */
class SignedInMode implements RuleMode {
  readonly features = [];
  readonly previewChapters = 0;
  chapter(viewer: Viewer): ChapterAccess {
    return viewer.signedIn ? "open" : "sign_in";
  }
  book(viewer: Viewer): BookAccess {
    return this.chapter(viewer);
  }
  reader(): ReaderAccess {
    return "open";
  }
}

/** A grant with one of the features reads all; the first chapters are a preview. */
class GrantMode implements RuleMode {
  readonly features: readonly string[];
  readonly previewChapters: number;

  constructor(rule: Extract<AccessRule, { mode: "grant" }>) {
    this.features = [...rule.features];
    this.previewChapters = rule.previewChapters;
  }

  chapter(viewer: Viewer, n: number): ChapterAccess {
    if (!viewer.signedIn) return "sign_in";
    if (viewer.holdsAny(this.features)) return "granted";
    return n <= this.previewChapters ? "preview" : "locked";
  }

  book(viewer: Viewer): BookAccess {
    if (!viewer.signedIn) return "sign_in";
    if (viewer.holdsAny(this.features)) return "granted";
    return this.previewChapters > 0 ? "preview" : "locked";
  }

  reader(features: ReadonlySet<string>): ReaderAccess {
    if (this.features.some((feature) => features.has(feature)))
      return "granted";
    return this.previewChapters > 0 ? "preview" : "locked";
  }
}

type ModeFactory<M extends AccessRule["mode"]> = (
  rule: Extract<AccessRule, { mode: M }>,
) => RuleMode;

/** The strategy of every access-rule mode of the contract. */
export const RULE_MODES: { [M in AccessRule["mode"]]: ModeFactory<M> } = {
  free: () => new FreeMode(),
  signed_in: () => new SignedInMode(),
  grant: (rule) => new GrantMode(rule),
};

/** The mapped type pairs each mode with its own rule; the lookup keeps the pair. */
const modeOf = (rule: AccessRule): RuleMode =>
  (RULE_MODES[rule.mode] as (rule: AccessRule) => RuleMode)(rule);

/**
 * Who reads a book, from its status and rule. Drafts and archived books exist
 * for staff only; staff read every chapter of every book; everyone else
 * follows the rule's mode.
 */
export class BookPolicy {
  private readonly mode: RuleMode;

  constructor(
    readonly status: BookStatus,
    readonly rule: AccessRule,
  ) {
    this.mode = modeOf(rule);
  }

  visibleTo(viewer: Viewer): boolean {
    return viewer.staff || this.status === "published";
  }

  /** Access to chapter `n`; the preface has the access of chapter 1. */
  chapter(viewer: Viewer, n: number): ChapterAccess {
    return viewer.staff ? "staff" : this.mode.chapter(viewer, n);
  }

  /** Access to the book as a whole: the library card. */
  book(viewer: Viewer): BookAccess {
    return viewer.staff ? "staff" : this.mode.book(viewer);
  }

  /**
   * What the admin console shows for a reader with these features in force:
   * a signed-in reader whose platform roles are not known here.
   */
  readerAccess(features: ReadonlySet<string>): ReaderAccess {
    return this.mode.reader(features);
  }

  /** Features that unlock the book; none for books that are not paid. */
  get features(): string[] {
    return [...this.mode.features];
  }

  get previewChapters(): number {
    return this.mode.previewChapters;
  }
}
