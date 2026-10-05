/**
 * Where a grant stands at a moment. Payments records revocation and expiry
 * (`state`); an active grant also has a window, [validFrom, validUntil):
 * before it opens it is scheduled, once it closes it has expired (Payments
 * marks that a little later), in between it is in force. This is the rule
 * of Education's `inForce`, applied when the page renders.
 */
export const grantPhases = [
  "scheduled",
  "active",
  "expired",
  "revoked",
] as const;
export type GrantPhase = (typeof grantPhases)[number];

export function grantPhase(
  grant: {
    state: "active" | "revoked" | "expired";
    validFrom: string;
    validUntil: string | null;
  },
  now: number,
): GrantPhase {
  if (grant.state !== "active") return grant.state;
  if (grant.validUntil !== null && Date.parse(grant.validUntil) <= now)
    return "expired";
  if (Date.parse(grant.validFrom) > now) return "scheduled";
  return "active";
}
