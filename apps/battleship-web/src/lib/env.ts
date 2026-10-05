import type { PlatformUrls } from "@outegro/ui/lib/platform";
import { z } from "zod";

const blankAsMissing = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const origins = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  z.array(
    z
      .url()
      .refine((item) => new URL(item).origin === item.replace(/\/$/, ""), {
        message: "expected an origin without a path",
      })
      .transform((item) => new URL(item).origin),
  ),
);

/** Server-only configuration; nothing here reaches the browser except GAME_WS_URL, passed on purpose. */
export const env = z
  .object({
    /** Public address of this app, for the SSO callback and checkout return. */
    APP_URL: z.url().default("http://localhost:3005"),
    BATTLESHIP_API_URL: z.url().default("http://localhost:4004"),
    /** Public origin of the game WebSocket (ws:// locally, wss:// in production). */
    GAME_WS_URL: z
      .url()
      .refine((value) => /^wss?:$/.test(new URL(value).protocol), {
        message: "expected a ws:// or wss:// origin",
      })
      .default("ws://localhost:4004"),
    AUTH_API_URL: z.url().default("http://localhost:4001"),
    /** Public identity frontend: sign-in goes through its /authorize. */
    ID_URL: z.url().default("http://localhost:3002"),
    /** Public site with the privacy policy. */
    SITE_URL: z.url().default("https://outegro.dev"),
    /** Public payments frontend: purchases, subscriptions, renewal and cancel. */
    PAY_URL: z.url().default("https://pay.outegro.dev"),
    /** Public Education frontend, one of the apps in the account menu. */
    EDU_URL: z.url().default("https://edu.outegro.dev"),
    /** Public admin console, linked for users with a platform role. */
    ADMIN_URL: z.url().default("https://admin.outegro.dev"),
    /** Unset: the shop shows the products as "coming soon". */
    PAYMENTS_API_URL: z.preprocess(blankAsMissing, z.url().optional()),
    /** https origins a checkout redirect may lead to. */
    CHECKOUT_ORIGINS: origins,
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
  })
  .parse(process.env);

/** The game WebSocket endpoint the browser connects to. */
export const gameSocketUrl = `${new URL(env.GAME_WS_URL).origin}/ws`;

/** Public addresses of the platform apps, for cross-app links. */
export const platformUrls: PlatformUrls = {
  site: env.SITE_URL,
  id: env.ID_URL,
  pay: env.PAY_URL,
  battleship: env.APP_URL,
  edu: env.EDU_URL,
  admin: env.ADMIN_URL,
};
