import type { GrantStatus as View } from "@/lib/grants";
import type { Label } from "@/lib/labels";
import { Time } from "./data";
import { Status } from "./layout";

/**
 * Where a grant stands now (`grantStatus`): scheduled, in force, expired or
 * revoked, in the kit's status colours and always in words, so the state
 * never rests on colour alone. Where no column shows the grant's window
 * (an order, a player), `starts` puts the day a scheduled grant opens under
 * its status.
 */
export function GrantStatus({
  status,
  label,
  starts,
}: {
  status: View;
  label: Label;
  /** The word before the date ("Starts") and the grant's `validFrom`. */
  starts?: { label: string; at: string };
}) {
  const badge = (
    <Status tone={status.tone}>{label(status.kind, status.value)}</Status>
  );
  if (!starts || status.phase !== "scheduled") return badge;
  return (
    <span className="grant-status">
      {badge}
      <span className="small muted">
        {starts.label} <Time iso={starts.at} format="date" />
      </span>
    </span>
  );
}
