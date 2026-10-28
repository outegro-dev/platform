import { z } from "zod";

/** Server-only configuration; nothing here reaches the browser. */
export const env = z
  .object({
    /** Public address of this app, for the SSO callback and links back here. */
    APP_URL: z.url().default("http://localhost:3008"),
    /**
     * atelier-backend: the board, applications, inbox, pipeline, profile.
     * `mock` serves made-up data from src/lib/mock.ts and skips sign-in.
     */
    ATELIER_API_URL: z
      .union([z.literal("mock"), z.url()])
      .default("http://localhost:4008"),
    AUTH_API_URL: z.url().default("http://localhost:4001"),
    /** Public identity frontend: sign-in goes through its /authorize. */
    ID_URL: z.url().default("http://localhost:3002"),
    /** Public site with the privacy policy. */
    SITE_URL: z.url().default("https://outegro.dev"),
    /** Shared CV links (cv-links service): the preview frames PDFs from here. */
    CV_LINKS_URL: z.url().default("https://cv.outegro.dev"),
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
  })
  .parse(process.env);

/** Mock mode: made-up data, no backend and no sign-in. */
export const mockMode = env.ATELIER_API_URL === "mock";
