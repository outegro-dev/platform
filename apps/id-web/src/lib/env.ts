import type { PlatformUrls } from "@outegro/ui/lib/platform";
import { z } from "zod";

/** Server-only configuration; nothing here reaches the browser. */
export const env = z
  .object({
    AUTH_API_URL: z.url().default("http://localhost:4001"),
    NOTIFICATIONS_API_URL: z.url().default("http://localhost:4002"),
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
    /** Public site with the privacy policy. */
    SITE_URL: z.url().default("https://outegro.dev"),
    /** Public address of this app: the way back from payments. */
    ID_URL: z.url().default("https://id.outegro.dev"),
    /** Public payments frontend: purchases, subscriptions, renewal and cancel. */
    PAY_URL: z.url().default("https://pay.outegro.dev"),
    /** Public Battleship frontend, one of "Your apps". */
    BATTLESHIP_URL: z.url().default("https://battleship.outegro.dev"),
    /** Public Education frontend, one of "Your apps". */
    EDU_URL: z.url().default("https://edu.outegro.dev"),
    /** Public admin console, linked for users with a platform role. */
    ADMIN_URL: z.url().default("https://admin.outegro.dev"),
  })
  .parse(process.env);

/** Public addresses of the platform apps, for cross-app links. */
export const platformUrls: PlatformUrls = {
  site: env.SITE_URL,
  id: env.ID_URL,
  pay: env.PAY_URL,
  battleship: env.BATTLESHIP_URL,
  edu: env.EDU_URL,
  admin: env.ADMIN_URL,
};
