import { z } from "zod";

export const locales = ["en", "ru"] as const;
export const localeSchema = z.enum(locales);
export type Locale = z.infer<typeof localeSchema>;

export const isoDateTime = z.iso.datetime({ offset: false });

/**
 * Money in DTOs and events: `minor` is an integer string so JSON and JS
 * never lose precision; scale comes from server-side currency metadata.
 */
export const moneySchema = z.object({
  minor: z.string().regex(/^-?\d+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  scale: z.number().int().min(0).max(4),
});
export type Money = z.infer<typeof moneySchema>;

/** Cursor pagination: opaque cursor, default 25, max 100. */
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
