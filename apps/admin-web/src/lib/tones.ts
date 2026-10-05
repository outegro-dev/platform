/** Status colour of each domain state: one mapping for every screen. */

export type Tone = "ok" | "warn" | "bad" | "neutral" | "live" | "info";

const table: Record<string, Record<string, Tone>> = {
  user: { active: "ok", suspended: "bad", deleted: "neutral" },
  binding: { active: "ok", revoked: "neutral" },
  delivery: {
    pending: "neutral",
    leased: "info",
    accepted: "ok",
    delivered: "ok",
    retry_wait: "warn",
    failed: "bad",
    expired: "neutral",
    unknown: "warn",
  },
  order: { pending: "warn", paid: "ok", failed: "bad", refunded: "neutral" },
  subscription: {
    pending: "neutral",
    active: "ok",
    past_due: "warn",
    cancel_requested: "warn",
    cancelling: "warn",
    expired: "neutral",
    suspended: "bad",
  },
  payment: { confirmed: "ok", refunded: "neutral", disputed: "bad" },
  event: {
    received: "info",
    processed: "ok",
    ignored: "neutral",
    unmatched: "warn",
    mismatch: "bad",
    quarantined: "bad",
    invalid: "bad",
    failed: "bad",
  },
  grant: { active: "ok", revoked: "neutral", expired: "neutral" },
  // Where a grant stands now (`grantPhase`), not only what Payments recorded.
  grantPhase: {
    scheduled: "info",
    active: "ok",
    expired: "neutral",
    revoked: "neutral",
  },
  refund: {
    requested: "info",
    unmatched: "warn",
    review_required: "warn",
    recorded: "ok",
    open: "bad",
  },
  issue: { open: "warn", resolved: "ok" },
  severity: { low: "neutral", medium: "warn", high: "bad" },
  match: {
    placement: "live",
    battle: "live",
    finished: "neutral",
    aborted: "bad",
  },
  player: { active: "ok", suspended: "bad", deleted: "neutral" },
  book: { published: "ok", draft: "warn", archived: "neutral" },
  readerAccess: {
    open: "ok",
    granted: "ok",
    preview: "info",
    locked: "neutral",
  },
  // Education's AI assistant: off is a setting (no key, safe mode), not an
  // outage; paused (today's spending cap reached) needs a look.
  assist: { on: "ok", paused: "warn", off: "neutral" },
  attempt: { requesting: "info", ready: "ok", failed: "bad", unknown: "warn" },
  health: { up: "ok", degraded: "warn", down: "bad", unconfigured: "neutral" },
};

export function toneOf(kind: keyof typeof table | string, state: string): Tone {
  return table[kind]?.[state] ?? "neutral";
}
