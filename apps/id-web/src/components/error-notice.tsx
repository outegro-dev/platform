"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useOnline } from "@/lib/online";

/**
 * Body of an error boundary: says whether the connection or the service is
 * at fault, and retries by fetching the segment again (`retry`), with
 * progress on the button. Offline, the retry waits for the connection.
 */
export function ErrorNotice({
  retry,
  landmark = false,
}: {
  retry: () => void;
  /** The notice is the page's main content (outside the account layout). */
  landmark?: boolean;
}) {
  const t = useTranslations("errors");
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  const Tag = landmark ? "main" : "section";
  return (
    <Tag className="notice" id={landmark ? "main" : undefined} role="alert">
      <h1>{online ? t("title") : t("offlineTitle")}</h1>
      <p>{online ? t("body") : t("offlineBody")}</p>
      <Button
        size="lg"
        pending={pending}
        pendingLabel={t("retrying")}
        aria-disabled={!online || undefined}
        onClick={() => online && startTransition(retry)}
      >
        <ArrowClockwiseIcon />
        {t("retry")}
      </Button>
    </Tag>
  );
}
