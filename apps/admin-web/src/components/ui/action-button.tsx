"use client";

import { Button } from "@outegro/ui/button";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { type ReactNode, useActionState, useEffect } from "react";
import type { ActionResult } from "@/lib/actions";
import { useStores } from "@/stores/provider";

/**
 * A one-click command without side effects on others (a test message to
 * yourself): pending state in place, the outcome as a toast.
 */
export function ActionButton({
  action,
  hidden,
  label,
  icon,
  variant = "outline",
}: {
  action: (state: ActionResult, form: FormData) => Promise<ActionResult>;
  hidden: Record<string, string>;
  label: string;
  icon?: ReactNode;
  variant?: "outline" | "primary" | "ghost";
}) {
  const { toasts } = useStores();
  const [state, formAction, pending] = useActionState(action, {
    status: "idle",
  } as ActionResult);
  useEffect(() => {
    if (state.status === "success") toasts.push("ok", state.message);
    if (state.status === "error") toasts.push("bad", state.message);
  }, [state, toasts]);
  return (
    <form action={formAction}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant={variant}
        size="sm"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? (
          <CircleNotchIcon aria-hidden="true" className="spin" />
        ) : (
          icon
        )}
        {label}
      </Button>
    </form>
  );
}
