"use client";

import { Button } from "@outegro/ui/button";
import {
  CheckCircleIcon,
  WarningCircleIcon,
  WifiSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { isOffline, useOnline } from "@/lib/online";

export type StatusTone = "success" | "error" | "offline";
type Status = { id: number; text: string; tone: StatusTone };

const ShowStatus = createContext<(text: string, tone: StatusTone) => void>(
  () => {},
);

/** Reports the outcome of an action that has no form of its own to show it. */
export function useActionStatus() {
  return use(ShowStatus);
}

/**
 * For a submit or a link click that would need the network: while offline it
 * is stopped and explained right away instead of failing after a timeout.
 */
export function useOfflineGuard() {
  const show = use(ShowStatus);
  const t = useTranslations("status");
  return (event: { preventDefault(): void }) => {
    if (!isOffline()) return;
    event.preventDefault();
    show(t("offline"), "offline");
  };
}

const icons = {
  success: CheckCircleIcon,
  error: WarningCircleIcon,
  offline: WifiSlashIcon,
};

let lastId = 0;

/**
 * Outcome of list actions (sign a session out, mark a message read) and of
 * anything blocked offline: a card fixed to the bottom of the viewport, so it
 * never moves the page and is seen wherever the user has scrolled. Successes
 * fade after a few seconds; errors stay until dismissed or replaced.
 */
export function ActionStatusProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("status");
  const online = useOnline();
  const [status, setStatus] = useState<Status | null>(null);
  // "You're offline" stops being true the moment the connection is back.
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
      6000,
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
          {Icon && (
            <Icon
              aria-hidden="true"
              weight="bold"
              className="action-status-icon"
            />
          )}
          <p
            className="action-status-text"
            aria-live="polite"
            aria-atomic="true"
          >
            {visible?.text}
          </p>
          {visible && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("dismiss")}
              onClick={() => setStatus(null)}
            >
              <XIcon />
            </Button>
          )}
        </div>
      </div>
    </ShowStatus>
  );
}
