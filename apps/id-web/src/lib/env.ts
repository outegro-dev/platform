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
  })
  .parse(process.env);
