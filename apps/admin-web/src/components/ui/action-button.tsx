"use client";

import { Button } from "@outegro/ui/button";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type ReactNode, useActionState, useEffect } from "react";
import type { ActionResult } from "@/lib/actions";
import { isUnsent, sendAction, type Unsent } from "@/lib/send-action";
import { useStores } from "@/stores/provider";

/**
 * A one-click command without side effects on others (a test message to
 * yourself): pending state in place, the outcome as a toast. Offline, or
 * without an answer from the server, the toast says so instead of an error
 * page, and the button is there for another click.
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
  const t = useTranslations("actions");
  const { toasts } = useStores();
  const run = async (
    previous: ActionResult | Unsent,
    data: FormData,
  ): Promise<ActionResult | Unsent> => {
    const result = await sendAction(
      () => action(isUnsent(previous) ? { status: "idle" } : previous, data),
      () => navigator.onLine,
    );
    if (isUnsent(result))
      toasts.push(
        "bad",
        t(result.status === "offline" ? "offlineCommand" : "failedCommand"),
      );
    return result;
  };
  const [state, formAction, pending] = useActionState(run, {
    status: "idle",
  } as ActionResult | Unsent);
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
