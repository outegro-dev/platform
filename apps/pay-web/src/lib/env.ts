import { z } from "zod";

/** "a, b," → ["a", "b"]; each entry must be an https origin without a path. */
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
      .refine(
        (item) => {
          const url = new URL(item);
          return (
            url.protocol === "https:" && item.replace(/\/$/, "") === url.origin
          );
        },
        { message: "expected an https origin without a path" },
      )
      .transform((item) => new URL(item).origin),
  ),
);

/** Server-only configuration; nothing here reaches the browser. */
export const env = z
  .object({
    PAYMENTS_API_URL: z.url().default("http://localhost:4003"),
    AUTH_API_URL: z.url().default("http://localhost:4001"),
    /** Public identity frontend: sign-in goes through its /authorize. */
    ID_URL: z.url().default("http://localhost:3002"),
    /** Public address of this app: SSO callback and checkout return page. */
    APP_URL: z.url().default("http://localhost:3003"),
    /** https origins a checkout may send the buyer to. Empty: buying is off. */
    CHECKOUT_ORIGINS: origins,
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
    /** Public site with the privacy policy. */
    SITE_URL: z.url().default("https://outegro.dev"),
  })
  .parse(process.env);
