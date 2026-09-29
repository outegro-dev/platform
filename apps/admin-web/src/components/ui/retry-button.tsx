"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

/**
 * Asks the server for this page again. The label never changes (no width
 * jump); the icon spins and the button reports busy while it loads.
 */
export function RetryButton({ label }: { label?: string }) {
  const router = useRouter();
  const t = useTranslations("common");
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      <ArrowClockwiseIcon
        aria-hidden="true"
        className={pending ? "spin" : undefined}
      />
      {label ?? t("retry")}
    </Button>
  );
}
