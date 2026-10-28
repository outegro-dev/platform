import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { AtelierDatabase } from "../common/database.js";
import { type CvLinksConfig, cvLinksConfig } from "../config/config.js";
import { cvLinks, cvVersions } from "../db/schema.js";
import { addFlag, addHistory } from "../orchestrator/board-ops.js";
import { STORAGE, type Storage } from "../storage/storage.js";

export const OWNER_COOKIE = "atelier_owner";

export type LinkLookup =
  | { status: "missing" }
  | { status: "revoked" }
  | {
      status: "ok";
      hash: string;
      fileName: string;
      storageKey: string;
      applicationId: string;
    };

/**
 * Public CV links: the hash finds the version, the file name in the path is
 * what the recruiter's download is called. Opens by people (not previews,
 * crawlers or the owner) are counted; the first one flags the card.
 */
@Injectable()
export class CvLinksService {
  constructor(
    @Inject(DATABASE) private readonly database: AtelierDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(cvLinksConfig.KEY) private readonly config: CvLinksConfig,
  ) {}

  canonicalUrl(hash: string, fileName: string) {
    return `${this.config.publicBaseUrl}/${hash}/${encodeURIComponent(fileName)}`;
  }

  async lookup(hash: string): Promise<LinkLookup> {
    const [row] = await this.database.db
      .select({
        hash: cvLinks.hash,
        revokedAt: cvLinks.revokedAt,
        fileName: cvVersions.fileName,
        storageKey: cvVersions.storageKey,
        applicationId: cvVersions.applicationId,
      })
      .from(cvLinks)
      .innerJoin(cvVersions, eq(cvVersions.id, cvLinks.cvVersionId))
      .where(eq(cvLinks.hash, hash));
    if (!row) return { status: "missing" };
    if (row.revokedAt) return { status: "revoked" };
    return {
      status: "ok",
      hash: row.hash,
      fileName: row.fileName,
      storageKey: row.storageKey,
      applicationId: row.applicationId,
    };
  }

  file(storageKey: string) {
    return this.storage.get(storageKey);
  }

  /** Counts a real open; the first one sets `cv_opened` and writes history. */
  async countOpen(link: { hash: string; applicationId: string }) {
    const now = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ firstOpenedAt: cvLinks.firstOpenedAt, opens: cvLinks.opens })
        .from(cvLinks)
        .where(eq(cvLinks.hash, link.hash))
        .for("update");
      if (!before) return;
      await tx
        .update(cvLinks)
        .set({
          opens: before.opens + 1,
          firstOpenedAt: before.firstOpenedAt ?? now,
        })
        .where(eq(cvLinks.hash, link.hash));
      if (before.firstOpenedAt) return;
      await addFlag(tx, link.applicationId, "cv_opened", now);
      await addHistory(tx, link.applicationId, {
        at: now,
        action: "CV opened",
        details: "the shared link was opened for the first time",
      });
    });
  }

  /** The value of the owner's device cookie; null when no secret is set. */
  ownerMark(): string | null {
    const secret = this.config.ownerCookieSecret;
    if (!secret) return null;
    return createHmac("sha256", secret)
      .update("atelier-owner-device")
      .digest("base64url");
  }

  isOwnerMark(value: string | undefined) {
    const expected = this.ownerMark();
    if (!expected || !value) return false;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  cookieDomain() {
    return this.config.ownerCookieDomain;
  }
}
