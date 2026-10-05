import { pageSchema } from "@outegro/contracts";
import {
  type AccessRule,
  type AdminBook,
  type AdminBookDetail,
  type AdminOverview,
  type AdminReader,
  type AdminUserEducation,
  adminAuditEntrySchema,
  adminBookDetailSchema,
  adminBooksResponseSchema,
  adminOverviewSchema,
  adminReadersPageSchema,
  adminUserEducationSchema,
  type BookStatus,
  bookSlugSchema,
  bookStatusSchema,
  type EduAuditAction,
  eduAuditActionSchema,
  readerAccessSchema,
} from "@outegro/contracts/edu";
import { z } from "zod";
import type { Page } from "../result";
import { OptionalServiceAdapter, parse } from "./base";

/**
 * edu-backend admin API (the textbooks at edu.outegro.dev; contract:
 * `@outegro/contracts/edu`): the only file that knows its paths and
 * response shapes; screens use the normalized views below. Every call
 * carries the operator's own token.
 *
 *   GET  /v1/admin/overview                            edu.read
 *   GET  /v1/admin/books                               edu.read
 *   GET  /v1/admin/books/:slug                         chapters with `reached`
 *   POST /v1/admin/books/:slug/status {status, expectedVersion, reason}   edu.manage
 *   POST /v1/admin/books/:slug/access {rule, expectedVersion, reason}     edu.manage
 *   GET  /v1/admin/readers?book&userId&cursor&limit    progress, newest activity first
 *   GET  /v1/admin/readers/:userId                     grants and progress; 404: never read, no grant
 *   GET  /v1/admin/audit?targetId&cursor&limit         targetId is a book slug
 *
 * Refusals: 409 VERSION_CONFLICT (status or rule changed meanwhile), 422
 * UNPROCESSABLE (nothing to change, or more free chapters than the book
 * has), 403 FORBIDDEN, 404 NOT_FOUND.
 */

export const bookStatuses = bookStatusSchema.options;
export const readerAccesses = readerAccessSchema.options;
/** Book slugs are the targets of Education's audit and the keys of its pages. */
export const isBookSlug = (value: string) =>
  bookSlugSchema.safeParse(value).success;
/** An audit action the contract names (and the console has words for). */
export const isEduAuditAction = (action: string): action is EduAuditAction =>
  eduAuditActionSchema.safeParse(action).success;
export type { AccessRule, BookStatus, EduAuditAction };
export type ReaderAccess = (typeof readerAccesses)[number];

/**
 * Education's audit, read tolerantly: an action (or a target) newer than the
 * contract this console was built with is still an entry, which the feed
 * shows by its code, instead of failing the whole feed. The rest of the
 * entry is checked as the contract says.
 */
const auditEntrySchema = adminAuditEntrySchema.extend({
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
});
const auditPageSchema = pageSchema(auditEntrySchema);

// Normalized views used by the screens.

export type EduOverview = AdminOverview;
export type BookView = AdminBook;
/** The book and its chapters; `reached` counts readers who got that far. */
export type BookDetail = AdminBookDetail;
export type BookChapter = BookDetail["chapters"][number];
export type ReaderView = AdminReader;
export type UserEducation = AdminUserEducation;
export type ReaderGrant = UserEducation["grants"][number];
/**
 * The contract's entry as the console's timelines read it: `at` becomes
 * `createdAt`; the action is one of the contract's (`isEduAuditAction`, whose
 * target is a book slug) or a newer one, and the actor null for content
 * imports.
 */
export type EduAuditEntry = Omit<z.infer<typeof auditEntrySchema>, "at"> & {
  createdAt: string;
};

export type ReaderFilter = {
  book?: string;
  userId?: string;
  cursor?: string;
  limit?: number;
};

const bookPath = (slug: string) =>
  `/v1/admin/books/${encodeURIComponent(slug)}`;

export class EduAdmin extends OptionalServiceAdapter {
  async overview(): Promise<EduOverview> {
    return parse(
      adminOverviewSchema,
      await this.get("/v1/admin/overview", undefined, { list: true }),
      "education overview",
    );
  }

  async books(): Promise<BookView[]> {
    return parse(
      adminBooksResponseSchema,
      await this.get("/v1/admin/books", undefined, { list: true }),
      "education books",
    ).items;
  }

  async book(slug: string): Promise<BookDetail> {
    return parse(
      adminBookDetailSchema,
      await this.get(bookPath(slug)),
      "education book",
    );
  }

  /** Publish, back to draft or archive; `expectedVersion` is the book's `version`. */
  async setStatus(
    slug: string,
    input: { status: BookStatus; expectedVersion: number; reason: string },
  ): Promise<void> {
    await this.send("POST", `${bookPath(slug)}/status`, {
      status: input.status,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    });
  }

  /** Who reads the book: free, signed-in readers, or holders of a grant. */
  async setAccess(
    slug: string,
    input: { rule: AccessRule; expectedVersion: number; reason: string },
  ): Promise<void> {
    await this.send("POST", `${bookPath(slug)}/access`, {
      rule: input.rule,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    });
  }

  async readers(filter: ReaderFilter): Promise<Page<ReaderView>> {
    return parse(
      adminReadersPageSchema,
      await this.get("/v1/admin/readers", filter, { list: true }),
      "education readers",
    );
  }

  /** One user's grants and progress; 404 when they never read and hold no grant. */
  async reader(userId: string): Promise<UserEducation> {
    return parse(
      adminUserEducationSchema,
      await this.get(`/v1/admin/readers/${encodeURIComponent(userId)}`),
      "education reader",
    );
  }

  async audit(filter: {
    targetId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<EduAuditEntry>> {
    const result = parse(
      auditPageSchema,
      await this.get("/v1/admin/audit", filter, { list: true }),
      "education audit",
    );
    return {
      items: result.items.map(({ at, ...entry }) => ({
        ...entry,
        createdAt: at,
      })),
      nextCursor: result.nextCursor,
    };
  }
}
