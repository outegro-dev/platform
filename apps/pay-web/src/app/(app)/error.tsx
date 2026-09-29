"use client";

import {
  ArrowClockwiseIcon,
  CloudSlashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { BusyButton } from "@/components/busy-button";

/**
 * Anything unexpected inside the signed-in pages: the shell stays, the page
 * says what happened and offers a retry, never an empty list.
 */
export default function AppError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const states = useTranslations("states");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="card state-panel" data-tone="danger" role="alert">
      <span className="state-icon" aria-hidden="true">
        <CloudSlashIcon />
      </span>
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
      <div className="state-actions">
        <BusyButton
          size="lg"
          busy={pending}
          busyLabel={states("retrying")}
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          <ArrowClockwiseIcon aria-hidden="true" />
          {t("retry")}
        </BusyButton>
      </div>
    </section>
  );
}
