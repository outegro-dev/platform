import { grantStates } from "./adapters/payments";
import { type Tone, toneOf } from "./tones";

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

/** What Payments records about a grant. */
export type GrantState = (typeof grantStates)[number];
/** A state Payments records (a service passing it on may type it loosely). */
export const isGrantState = (value: string): value is GrantState =>
  (grantStates as readonly string[]).includes(value);

export function grantPhase(
  grant: {
    state: GrantState;
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

/**
 * A grant's status as the lists show it: where it stands now, in the status
 * colour of that phase. Services pass the recorded state on as a string; a
 * state Payments does not write (a newer service) shows as recorded, in
 * readable words and without a phase.
 */
export type GrantStatus = {
  phase: GrantPhase | null;
  tone: Tone;
  /** The label list (`labels.<kind>.<value>`) that names it. */
  kind: "grantPhase" | "grantState";
  value: string;
};

export function grantStatus(
  grant: { state: string; validFrom: string; validUntil: string | null },
  now: number,
): GrantStatus {
  if (!isGrantState(grant.state))
    return {
      phase: null,
      tone: toneOf("grant", grant.state),
      kind: "grantState",
      value: grant.state,
    };
  const phase = grantPhase({ ...grant, state: grant.state }, now);
  return {
    phase,
    tone: toneOf("grantPhase", phase),
    kind: "grantPhase",
    value: phase,
  };
}

/**
 * Whether revoking still changes something: a grant in force, or one booked
 * ahead (Payments records both as active). An expired grant has already
 * ended, even before Payments marks it so; a revoked one is done; a state
 * the console does not know is left alone.
 */
export function revocable(phase: GrantPhase | null): boolean {
  return phase === "active" || phase === "scheduled";
}
