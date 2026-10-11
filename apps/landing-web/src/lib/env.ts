import { z } from "zod";

const blankAsMissing = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * Local development and tests default to the local stack. Production has
 * no defaults: without these addresses the site runs without SSO (see
 * `sso` in ./sso), never against localhost.
 */
const local = process.env.NODE_ENV !== "production";
const address = (fallback: string) =>
  z.preprocess(
    blankAsMissing,
    local ? z.url().default(fallback) : z.url().optional(),
  );

/**
 * Server-only configuration; nothing here reaches the browser but the GTM
 * container id, which is public by design. Parsed when first imported:
 * /health imports it too, so a bad value fails the probe instead of only
 * every page.
 */
export const env = z
  .object({
    /** Public address of this site, for the SSO callback and links back here. */
    APP_URL: address("http://localhost:3000"),
    AUTH_API_URL: address("http://localhost:4001"),
    /** Public identity frontend: sign-in goes through its /authorize. */
    ID_URL: address("http://localhost:3002"),
    /** Where the visitor's IP comes from: Traefik directly or the Cloudflare proxy. */
    CLIENT_IP_SOURCE: z
      .enum(["x-forwarded-for", "cf-connecting-ip"])
      .default("x-forwarded-for"),
    /**
     * Google Tag Manager container for reader statistics, read at runtime.
     * Unset, blank or malformed: no tag, no consent note, no Google hosts in
     * the CSP. A typo turns statistics off, never the site.
     */
    GTM_ID: z
      .preprocess(
        blankAsMissing,
        z
          .string()
          .regex(/^GTM-[A-Z0-9]+$/)
          .optional(),
      )
      .catch(({ input }) => {
        console.warn(
          `[landing-web] GTM_ID ${JSON.stringify(input)} is not a container id like GTM-XXXXXXX; statistics are off`,
        );
        return undefined;
      }),
  })
  .refine(
    ({ APP_URL, AUTH_API_URL, ID_URL }) =>
      new Set([APP_URL, AUTH_API_URL, ID_URL].map(Boolean)).size === 1,
    {
      message:
        "APP_URL, ID_URL and AUTH_API_URL go together: set all three for sign-in, or none",
    },
  )
  .parse(process.env);
