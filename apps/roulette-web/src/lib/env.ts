import { z } from "zod";

/** Server-only configuration; nothing here reaches the browser except GAME_WS_URL, passed on purpose. */
export const env = z
  .object({
    /** Public address of this app, for the SSO callback. */
    APP_URL: z.url().default("http://localhost:3007"),
    ROULETTE_API_URL: z.url().default("http://localhost:4006"),
    /** Public origin of the game WebSocket (ws:// locally, wss:// in production). */
    GAME_WS_URL: z
      .url()
      .refine((value) => /^wss?:$/.test(new URL(value).protocol), {
        message: "expected a ws:// or wss:// origin",
      })
      .default("ws://localhost:4006"),
    /** wallet-backend: the player's own balance (`GET /v1/me/wallet`). */
    WALLET_API_URL: z.url().default("http://localhost:4007"),
    /** daily-bonus-backend: the bonus of the day. */
    DAILY_API_URL: z.url().default("http://localhost:4101"),
    AUTH_API_URL: z.url().default("http://localhost:4001"),
    /** Public identity frontend: sign-in goes through its /authorize. */
    ID_URL: z.url().default("http://localhost:3002"),
    /** Public site with the privacy policy. */
    SITE_URL: z.url().default("https://outegro.dev"),
    /** Public payments frontend, linked from the account links. */
    PAY_URL: z.url().default("https://pay.outegro.dev"),
    EDU_URL: z.url().default("https://edu.outegro.dev"),
    BATTLESHIP_URL: z.url().default("https://battleship.outegro.dev"),
    ADMIN_URL: z.url().default("https://admin.outegro.dev"),
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
  })
  .parse(process.env);

/** The game WebSocket endpoint the browser connects to. */
export const gameSocketUrl = `${new URL(env.GAME_WS_URL).origin}/ws`;
