import type { GrantStatus as View } from "@/lib/grants";
import type { Label } from "@/lib/labels";
import { Status } from "./layout";

/**
 * Where a grant stands now (`grantStatus`): scheduled, in force, expired or
 * revoked, in the kit's status colours and always in words, so the state
 * never rests on colour alone.
 */
export function GrantStatus({ status, label }: { status: View; label: Label }) {
  return <Status tone={status.tone}>{label(status.kind, status.value)}</Status>;
}
