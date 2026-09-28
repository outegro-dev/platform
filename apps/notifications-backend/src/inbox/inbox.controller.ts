import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  CurrentUser,
  DATABASE,
} from "@outegro/nest-common";
import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { NotificationsDatabase } from "../common/database.js";
import {
  categories,
  channels,
  inboxItems,
  preferences,
  recipients,
} from "../db/schema.js";
import { templateFor, templates } from "../templates/registry.js";

const listSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  category: z.enum(categories).optional(),
});
const preferencesSchema = z.object({
  expectedVersion: z.number().int().positive(),
  items: z
    .array(
      z.object({
        category: z.enum(categories),
        channel: z.enum(channels),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(12),
});

const encode = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
const decode = (cursor: string) => {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  // The id goes into a uuid comparison; anything else would be a 500.
  if (!id || !z.uuid().safeParse(id).success || Number.isNaN(date.getTime()))
    throw new AppError("VALIDATION_FAILED");
  return { at: date, id };
};

/** A category's most permissive template decides which channels are mandatory there. */
const mandatoryFor = (category: string, channel: string) =>
  Object.values(templates).some(
    (t) => t.category === category && t.mandatory.includes(channel as never),
  );

@Controller("me")
export class InboxController {
  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get("inbox")
  async inbox(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: listSchema }) query: z.infer<typeof listSchema>,
  ) {
    const cursor = query.cursor ? decode(query.cursor) : null;
    const [recipient] = await this.database.db
      .select({ locale: recipients.locale })
      .from(recipients)
      .where(eq(recipients.userId, user.userId));
    const locale = recipient?.locale ?? "en";
    const rows = await this.database.db
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, user.userId),
          query.category ? eq(inboxItems.category, query.category) : undefined,
          cursor
            ? or(
                lt(inboxItems.createdAt, cursor.at),
                and(
                  eq(inboxItems.createdAt, cursor.at),
                  lt(inboxItems.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
      .limit(query.limit + 1);
    const [unread] = await this.database.db
      .select({ value: count() })
      .from(inboxItems)
      .where(
        and(eq(inboxItems.userId, user.userId), isNull(inboxItems.readAt)),
      );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((item) => {
        const template = templateFor(item.templateKey);
        const data = item.data as Record<
          string,
          string | number | boolean | null
        >;
        return {
          id: item.id,
          category: item.category,
          title: template.title(locale, data),
          body: template.text(locale, data),
          createdAt: item.createdAt.toISOString(),
          readAt: item.readAt?.toISOString() ?? null,
        };
      }),
      unreadCount: unread?.value ?? 0,
      nextCursor:
        rows.length > query.limit && last
          ? encode(last.createdAt, last.id)
          : null,
    };
  }

  /** Idempotent; someone else's item looks exactly like a missing one. */
  @Post("inbox/:id/read")
  @HttpCode(204)
  async read(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
    const [item] = await this.database.db
      .update(inboxItems)
      .set({
        readAt: sql`coalesce(${inboxItems.readAt}, ${this.clock.now().toISOString()}::timestamptz)`,
      })
      .where(and(eq(inboxItems.id, id), eq(inboxItems.userId, user.userId)))
      .returning({ id: inboxItems.id });
    if (!item) throw new AppError("NOT_FOUND");
  }

  @Get("notification-preferences")
  async getPreferences(@CurrentUser() user: AuthenticatedUser) {
    const [recipient] = await this.database.db
      .select({ version: recipients.preferencesVersion })
      .from(recipients)
      .where(eq(recipients.userId, user.userId));
    const rows = await this.database.db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, user.userId));
    return {
      version: recipient?.version ?? 1,
      items: categories
        .filter((category) => category !== "auth")
        .flatMap((category) =>
          channels.map((channel) => {
            const mandatory = mandatoryFor(category, channel);
            const row = rows.find(
              (r) => r.category === category && r.channel === channel,
            );
            return {
              category,
              channel,
              enabled: mandatory || (row?.enabled ?? true),
              mandatory,
            };
          }),
        ),
    };
  }

  @Patch("notification-preferences")
  async setPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: preferencesSchema }) body: z.infer<
      typeof preferencesSchema
    >,
  ) {
    for (const item of body.items) {
      if (!item.enabled && mandatoryFor(item.category, item.channel)) {
        throw new AppError("UNPROCESSABLE", {
          fieldErrors: { [`${item.category}.${item.channel}`]: ["mandatory"] },
        });
      }
    }
    const now = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(recipients)
        .values({ userId: user.userId, updatedAt: now })
        .onConflictDoNothing();
      const [bumped] = await tx
        .update(recipients)
        .set({
          preferencesVersion: sql`${recipients.preferencesVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(recipients.userId, user.userId),
            eq(recipients.preferencesVersion, body.expectedVersion),
          ),
        )
        .returning({ version: recipients.preferencesVersion });
      if (!bumped) throw new AppError("VERSION_CONFLICT");
      for (const item of body.items) {
        await tx
          .insert(preferences)
          .values({ userId: user.userId, ...item, updatedAt: now })
          .onConflictDoUpdate({
            target: [
              preferences.userId,
              preferences.category,
              preferences.channel,
            ],
            set: { enabled: item.enabled, updatedAt: now },
          });
      }
    });
    return this.getPreferences(user);
  }
}
