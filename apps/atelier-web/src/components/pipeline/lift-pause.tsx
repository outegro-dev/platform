"use client";

import { Button } from "@outegro/ui/button";
import { PlayIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useWrite } from "@/components/chrome/action-status";
import { writeApi } from "@/lib/client-api";

/** Lifts a provider's pause now instead of waiting for it to run out. */
export function LiftPause({ provider }: { provider: string }) {
  const t = useTranslations("pipeline");
  const { run, pending } = useWrite();
  return (
    <Button
      variant="outline"
      size="sm"
      pending={pending}
      pendingLabel={t("lifting")}
      onClick={() =>
        run(
          () =>
            writeApi(
              "DELETE",
              `/providers/${encodeURIComponent(provider)}/pause`,
            ),
          {
            success: () => t("lifted", { provider }),
            failure: t("liftFailed"),
          },
        )
      }
    >
      <PlayIcon aria-hidden="true" weight="bold" />
      {t("liftPause")}
    </Button>
  );
}
