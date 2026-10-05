import { z } from "zod";

const baseUrl = z.url().transform((value) => value.replace(/\/+$/, ""));

/** An empty value means "not set": optional services stay "not connected". */
const optionalBaseUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  baseUrl.optional(),
);

/** Server-only configuration; nothing here reaches the browser. */
export const env = z
  .object({
    AUTH_API_URL: baseUrl.default("http://localhost:4001"),
    NOTIFICATIONS_API_URL: baseUrl.default("http://localhost:4002"),
    /** battleship-backend; unset until the game service is deployed. */
    BATTLESHIP_API_URL: optionalBaseUrl,
    /** payments-backend admin API; unset until payments go live. */
    PAYMENTS_ADMIN_API_URL: optionalBaseUrl,
    /** edu-backend (textbooks at edu.outegro.dev); unset until it is deployed. */
    EDU_API_URL: optionalBaseUrl,
    /** Public origin of the identity frontend (sign-in). */
    ID_URL: baseUrl.default("http://localhost:3002"),
    /** Public origin of this console; the SSO callback lives under it. */
    APP_URL: baseUrl.default("http://localhost:3004"),
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
  })
  .parse(process.env);

export type Env = typeof env;
