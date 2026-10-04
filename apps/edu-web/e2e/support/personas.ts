/**
 * Test readers. The fake identity page signs in as the persona named in the
 * `e2e_persona` cookie; every sign-in creates a fresh user with that setup.
 */
export type Persona = "reader" | "subscriber" | "staff";

export const personas: Record<
  Persona,
  {
    displayName: string | null;
    /** Platform roles (identity-access): support holds edu.read. */
    roles: string[];
    /** Active Payments grants of service "edu". */
    features: string[];
  }
> = {
  // Signed in, no grant: the preview chapter only.
  reader: { displayName: "Anna Reader", roles: [], features: [] },
  // The "library" grant: every published book.
  subscriber: {
    displayName: "Boris Subscriber",
    roles: [],
    features: ["library"],
  },
  // Support staff: edu.read opens every book for proofreading.
  staff: { displayName: "Olga Petrova", roles: ["support"], features: [] },
};

export function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && value in personas;
}

/** The account's email: the persona's name on the test domain. */
export const emailOf = (persona: Persona) => `${persona}@outegro.test`;
