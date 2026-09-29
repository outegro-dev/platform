"use client";

import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { BusyButton } from "./busy-button";

/** Asks the server again for this page's data, in place. */
export function RetryButton() {
  const t = useTranslations("states");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <BusyButton
      size="lg"
      busy={pending}
      busyLabel={t("retrying")}
      onClick={() => startTransition(() => router.refresh())}
    >
      <ArrowClockwiseIcon aria-hidden="true" />
      {t("retry")}
    </BusyButton>
  );
}
