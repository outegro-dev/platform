/**
 * Test players. The fake identity page signs in as the persona named in the
 * `e2e_persona` cookie; every sign-in creates a fresh user with that setup.
 */
export type Persona =
  | "free"
  | "premium"
  | "stale-premium"
  | "silver"
  | "rookie"
  | "unlucky"
  | "operator";

export const personas: Record<
  Persona,
  {
    nickname: string;
    rating: number;
    matches: number;
    wins: number;
    features: string[];
    equipped: {
      ships: "classic" | "silver";
      hitEffect: "flame" | "shards";
      theme: "day" | "night-sea";
    };
  }
> = {
  free: {
    nickname: "Sailor 4821",
    rating: 1016,
    matches: 12,
    wins: 7,
    features: [],
    equipped: { ships: "classic", hitEffect: "flame", theme: "day" },
  },
  premium: {
    nickname: "Admiral Nelson",
    rating: 1342,
    matches: 64,
    wins: 41,
    features: ["premium"],
    equipped: { ships: "silver", hitEffect: "shards", theme: "day" },
  },
  // The profile still says Premium, the game server no longer does.
  "stale-premium": {
    nickname: "Captain Late",
    rating: 1120,
    matches: 30,
    wins: 15,
    features: ["premium"],
    equipped: { ships: "classic", hitEffect: "flame", theme: "day" },
  },
  silver: {
    nickname: "Silver Mira",
    rating: 1188,
    matches: 22,
    wins: 13,
    features: ["cosmetics.silver-fleet"],
    equipped: { ships: "silver", hitEffect: "shards", theme: "night-sea" },
  },
  // The game server is unreachable for the first few ticket requests.
  unlucky: {
    nickname: "Sailor 1313",
    rating: 1000,
    matches: 2,
    wins: 1,
    features: [],
    equipped: { ships: "classic", hitEffect: "flame", theme: "day" },
  },
  rookie: {
    nickname: "Sailor 0007",
    rating: 1000,
    matches: 0,
    wins: 0,
    features: [],
    equipped: { ships: "classic", hitEffect: "flame", theme: "day" },
  },
  // Holds a platform role (support): the account menu links the admin console.
  operator: {
    nickname: "Harbour Master",
    rating: 1100,
    matches: 5,
    wins: 3,
    features: [],
    equipped: { ships: "classic", hitEffect: "flame", theme: "day" },
  },
};

export function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && value in personas;
}

/**
 * The platform account behind each persona, as Identity's /v1/me tells it.
 * Personas without a display name are known by their email only.
 */
export const accounts: Record<
  Persona,
  { displayName: string | null; roles: string[] }
> = {
  free: { displayName: "Nick Lukashik", roles: [] },
  premium: { displayName: null, roles: [] },
  "stale-premium": { displayName: "Late Captain", roles: [] },
  silver: { displayName: "Mira Silver", roles: [] },
  unlucky: { displayName: null, roles: [] },
  rookie: { displayName: null, roles: [] },
  operator: { displayName: "Olga Petrova", roles: ["support"] },
};

/** The account's email: the persona's name on the test domain. */
export const emailOf = (persona: Persona) => `${persona}@outegro.test`;

/** What a WebSocket ticket carries in this fake world (the real one is opaque). */
export type TicketClaims = { uid: string; persona: Persona; n: number };

export function encodeTicket(claims: TicketClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return body.length >= 32 ? body : `${body}${".".repeat(32 - body.length)}`;
}

export function decodeTicket(ticket: string): TicketClaims | null {
  try {
    const value = JSON.parse(
      Buffer.from(ticket.replace(/\.+$/, ""), "base64url").toString("utf8"),
    );
    return isPersona(value?.persona) && typeof value?.uid === "string"
      ? (value as TicketClaims)
      : null;
  } catch {
    return null;
  }
}
