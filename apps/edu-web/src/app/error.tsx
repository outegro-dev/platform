"use client";

import { Button } from "@outegro/ui/button";
import { StatePanel } from "@outegro/ui/notice";
import {
  ArrowClockwiseIcon,
  CloudSlashIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useOnline } from "@/lib/browser";

/**
 * A service that did not answer gets a retry, not a blank page. The retry
 * fetches the segment again (`retry`, not `reset`, which would only
 * re-render what failed), with progress on the button; offline, it says so
 * and the retry waits for the connection.
 */
export default function RootError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("errors");
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  return (
    <main id="main" className="app-main og-container">
      <StatePanel
        className="min-h-[52vh]"
        tone="danger"
        live="assertive"
        headingLevel={1}
        icon={
          online ? (
            <CloudSlashIcon aria-hidden="true" />
          ) : (
            <WifiSlashIcon aria-hidden="true" />
          )
        }
        title={online ? t("title") : t("offlineTitle")}
        description={online ? t("body") : t("offlineBody")}
        actions={
          <Button
            size="lg"
            pending={pending}
            pendingLabel={t("retrying")}
            aria-disabled={!online || undefined}
            onClick={() => {
              if (online) startTransition(retry);
            }}
          >
            <ArrowClockwiseIcon aria-hidden="true" />
            {t("retry")}
          </Button>
        }
      />
    </main>
  );
}
