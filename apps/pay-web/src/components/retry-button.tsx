"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

/** Asks the server again for this page's data, in place. */
export function RetryButton() {
  const t = useTranslations("states");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      pending={pending}
      pendingLabel={t("retrying")}
      onClick={() => startTransition(() => router.refresh())}
    >
      <ArrowClockwiseIcon aria-hidden="true" />
      {t("retry")}
    </Button>
  );
}
