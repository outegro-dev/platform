// Public contact channels shown on the site.
export const contacts = [
  {
    key: "email",
    handle: "coping.barrel@gmail.com",
    href: "mailto:coping.barrel@gmail.com",
  },
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

export type ContactKey = (typeof contacts)[number]["key"];
