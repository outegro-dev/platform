import type { PlatformUrls } from "@outegro/ui/lib/platform";
import { z } from "zod";

const blankAsMissing = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Server-only configuration; nothing here reaches the browser. */
export const env = z
  .object({
    /** Public address of this app, for the SSO callback and links back here. */
    APP_URL: z.url().default("http://localhost:3006"),
    /** edu-backend: books, access and reading progress. */
    EDU_API_URL: z.url().default("http://localhost:4005"),
    AUTH_API_URL: z.url().default("http://localhost:4001"),
    /** Public identity frontend: sign-in goes through its /authorize. */
    ID_URL: z.url().default("http://localhost:3002"),
    /** Public site with the privacy policy and the contact form. */
    SITE_URL: z.url().default("https://outegro.dev"),
    /** Public payments frontend: the catalog, purchases and subscriptions. */
    PAY_URL: z.url().default("https://pay.outegro.dev"),
    /** Public admin console, linked for users with a platform role. */
    ADMIN_URL: z.url().default("https://admin.outegro.dev"),
    /** The other platform app, for the account menu. */
    BATTLESHIP_URL: z.url().default("https://battleship.outegro.dev"),
    /** Public catalog of payments; unset: access is granted by invitation. */
    PAYMENTS_API_URL: z.preprocess(blankAsMissing, z.url().optional()),
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
  })
  .parse(process.env);

/** Public addresses of the platform apps, for cross-app links. */
export const platformUrls: PlatformUrls = {
  site: env.SITE_URL,
  id: env.ID_URL,
  pay: env.PAY_URL,
  battleship: env.BATTLESHIP_URL,
  edu: env.APP_URL,
  admin: env.ADMIN_URL,
};
