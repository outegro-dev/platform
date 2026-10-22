// Public contact channels shown on the site.

/**
 * The email in two halves. Cloudflare's Email Address Obfuscation rewrites
 * any whole address it finds in the HTML and loads a decoder script that our
 * CSP blocks, which broke the link and React hydration (11.10.2026). The
 * address is joined only in the browser, see EmailLink.
 */
export const email = { user: "coping.barrel", domain: "gmail.com" } as const;

export const contacts = [
  {
    key: "telegram",
    handle: "@coping_barrel",
    href: "https://t.me/coping_barrel",
  },
  {
    key: "linkedin",
    handle: "in/nick-lukashick",
    href: "https://www.linkedin.com/in/nick-lukashick/",
  },
  {
    key: "github",
    handle: "coping-barrel",
    href: "https://github.com/coping-barrel",
  },
] as const;

/** A 30-minute intro call: Calendly with the owner's free slots. */
export const calendly = "https://calendly.com/nick-lukashik/30min";
