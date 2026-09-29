import { Inject, Injectable } from "@nestjs/common";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { NotificationsDatabase } from "../common/database.js";
import { adminAudit, settings } from "../db/schema.js";

export const channelSettingsSchema = z.object({
  email: z.object({ enabled: z.boolean() }),
  telegram: z.object({ enabled: z.boolean() }),
});
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
export type ExternalChannel = keyof ChannelSettings;

const KEY = "channels";
const DEFAULTS: ChannelSettings = {
  email: { enabled: true },
  telegram: { enabled: true },
};
const CACHE_MS = 5_000;

/**
 * Operator switches for external channels. A paused channel keeps its
 * deliveries pending (they still expire by TTL) until it is resumed.
 */
@Injectable()
export class SettingsService {
  private cached: { paused: ExternalChannel[]; at: number } | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async channels() {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.key, KEY));
    const parsed = channelSettingsSchema.safeParse(row?.value);
    return {
      version: row?.version ?? 0,
      channels: parsed.success ? parsed.data : DEFAULTS,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  /** Read on every worker pass; cached briefly, dropped on change. */
  async pausedChannels(): Promise<ExternalChannel[]> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_MS)
      return this.cached.paused;
    const { channels } = await this.channels();
    const paused = (Object.keys(channels) as ExternalChannel[]).filter(
      (channel) => !channels[channel].enabled,
    );
    this.cached = { paused, at: now };
    return paused;
  }

  async updateChannels(input: {
    actorId: string;
    expectedVersion: number;
    channels: Partial<ChannelSettings>;
    reason: string;
  }) {
    const now = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(settings)
        .where(eq(settings.key, KEY))
        .for("update");
      const version = row?.version ?? 0;
      if (version !== input.expectedVersion)
        throw new AppError("VERSION_CONFLICT");
      const current = channelSettingsSchema.safeParse(row?.value);
      const before = current.success ? current.data : DEFAULTS;
      const after = { ...before, ...input.channels };
      if (row) {
        const [updated] = await tx
          .update(settings)
          .set({
            value: after,
            version: version + 1,
            updatedBy: input.actorId,
            updatedAt: now,
          })
          .where(and(eq(settings.key, KEY), eq(settings.version, version)))
          .returning({ key: settings.key });
        if (!updated) throw new AppError("VERSION_CONFLICT");
      } else {
        await tx.insert(settings).values({
          key: KEY,
          value: after,
          version: 1,
          updatedBy: input.actorId,
          updatedAt: now,
        });
      }
      await tx.insert(adminAudit).values({
        actorId: input.actorId,
        action: "settings.channels.update",
        targetType: "settings",
        targetId: KEY,
        reason: input.reason,
        data: { before, after },
        createdAt: now,
      });
    });
    this.cached = null;
    return this.channels();
  }
}
