"use client";

import { Button } from "@outegro/ui/button";
import {
  CheckCircleIcon,
  WarningCircleIcon,
  WifiSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useOnline } from "@/lib/browser";
import type { WriteFailure, WriteResult } from "@/lib/client-api";

export type StatusTone = "success" | "error" | "offline";
type Status = { id: number; text: string; tone: StatusTone };

const ShowStatus = createContext<(text: string, tone: StatusTone) => void>(
  () => {},
);

/** Reports the outcome of an action that has no place of its own to show it. */
export function useActionStatus() {
  return use(ShowStatus);
}

const icons = {
  success: CheckCircleIcon,
  error: WarningCircleIcon,
  offline: WifiSlashIcon,
};

let lastId = 0;

/**
 * Outcome of writes (move, send, take, skip, lift a pause) and of anything
 * blocked offline: a slip fixed to the bottom of the viewport, so it never
 * moves the page and is seen wherever the owner has scrolled. Successes
 * fade; errors stay until dismissed or replaced; "offline" goes away by
 * itself once the connection is back.
 */
export function ActionStatusProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("status");
  const online = useOnline();
  const [status, setStatus] = useState<Status | null>(null);
  const visible = status?.tone === "offline" && online ? null : status;

  const show = (text: string, tone: StatusTone) => {
    // Empty the live region first, so a repeated message is announced again.
    setStatus(null);
    const id = ++lastId;
    requestAnimationFrame(() => setStatus({ id, text, tone }));
  };

  useEffect(() => {
    if (status?.tone !== "success") return;
    const timer = setTimeout(
      () =>
        setStatus((current) => (current?.id === status.id ? null : current)),
      5000,
    );
    return () => clearTimeout(timer);
  }, [status]);

  const Icon = visible ? icons[visible.tone] : null;
  return (
    <ShowStatus value={show}>
      {children}
      <div
        className="action-status"
        data-open={visible ? "" : undefined}
        data-tone={visible?.tone}
      >
        <div className="action-status-card">
          {Icon ? (
            <Icon
              aria-hidden="true"
              weight="bold"
              className="action-status-icon"
            />
          ) : null}
          <p
            className="action-status-text"
            aria-live="polite"
            aria-atomic="true"
            data-testid="action-status"
          >
            {visible?.text}
          </p>
          {visible ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("dismiss")}
              onClick={() => setStatus(null)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    </ShowStatus>
  );
}

/** What a failed write says, in the page's language. */
export function useFailureText() {
  const t = useTranslations("status");
  return (failure: WriteFailure): string =>
    ({
      offline: t("offline"),
      "signed-out": t("signedOut"),
      forbidden: t("forbidden"),
      "not-found": t("notFound"),
      conflict: t("conflict"),
      invalid: t("failed"),
      failed: t("failed"),
    })[failure];
}

/**
 * Runs a write through the BFF, then re-renders the page from the server
 * (the board, the drawer, the counts) and reports the outcome.
 */
export function useWrite() {
  const router = useRouter();
  const show = useActionStatus();
  const failureText = useFailureText();
  const [pending, startTransition] = useTransition();
  function run<T>(
    write: () => Promise<WriteResult<T>>,
    messages: { success?: (data: T) => string; failure?: string } = {},
  ): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await write();
        if (result.ok) {
          startTransition(() => router.refresh());
          if (messages.success) show(messages.success(result.data), "success");
          resolve(true);
          return;
        }
        if (result.failure === "conflict" || result.failure === "not-found")
          startTransition(() => router.refresh());
        show(
          result.failure === "offline" || !messages.failure
            ? failureText(result.failure)
            : messages.failure,
          result.failure === "offline" ? "offline" : "error",
        );
        resolve(false);
      });
    });
  }
  return { run, pending };
}
