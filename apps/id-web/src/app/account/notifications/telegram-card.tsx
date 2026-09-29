"use client";

import { Button } from "@outegro/ui/button";
import { TelegramLogoIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import {
  createTelegramLink,
  disconnectTelegram,
  type TelegramStatus,
  telegramStatus,
} from "./telegram-actions";

type Mode =
  | { kind: "idle" }
  | { kind: "waiting"; url: string; until: number }
  | { kind: "expired" }
  | { kind: "error"; key: "unavailable" | "rate_limited" | "disconnect" };

const POLL_MS = 3000;

/** Connect Telegram (N-04): one-time deep link, then wait for the bot to confirm. */
export function TelegramCard({ initial }: { initial: TelegramStatus }) {
  const t = useTranslations("telegram");
  const format = useFormatter();
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  // While waiting, ask every few seconds whether the bot has linked the chat.
  useEffect(() => {
    if (mode.kind !== "waiting") return;
    const timer = setInterval(async () => {
      if (Date.now() > mode.until) {
        setMode({ kind: "expired" });
        return;
      }
      const next = await telegramStatus();
      if (next?.linked) {
        setStatus(next);
        setMode({ kind: "idle" });
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [mode, router]);

  const connect = () =>
    startTransition(async () => {
      // Opened synchronously with the click so popup blockers allow it.
      const tab = window.open("", "_blank");
      const result = await createTelegramLink();
      if (!result.ok) {
        tab?.close();
        if (result.error === "signed_out") {
          window.location.assign("/login?continue=%2Faccount%2Fnotifications");
          return;
        }
        setMode({ kind: "error", key: result.error });
        return;
      }
      if (tab) {
        tab.opener = null;
        tab.location.href = result.url;
      }
      setMode({
        kind: "waiting",
        url: result.url,
        until: Date.parse(result.expiresAt),
      });
    });

  const disconnect = () =>
    startTransition(async () => {
      const result = await disconnectTelegram();
      if (!result.ok) {
        setMode({ kind: "error", key: "disconnect" });
        return;
      }
      setStatus({ ...status, linked: false, linkedAt: null });
      setMode({ kind: "idle" });
    });

  const line = !status.available
    ? { tone: undefined, text: t("unavailable") }
    : status.linked
      ? {
          tone: "success",
          text: status.linkedAt
            ? t("linkedSince", {
                date: format.dateTime(new Date(status.linkedAt), {
                  dateStyle: "medium",
                }),
              })
            : t("linked"),
        }
      : mode.kind === "waiting"
        ? { tone: undefined, text: t("waiting") }
        : mode.kind === "expired"
          ? { tone: "error", text: t("expired") }
          : mode.kind === "error"
            ? { tone: "error", text: t(`errors.${mode.key}`) }
            : { tone: undefined, text: t("notLinked") };

  return (
    <div className="method">
      <TelegramLogoIcon aria-hidden="true" />
      <div className="method-text">
        <strong>{t("title")}</strong>
        <span
          className="channel-status"
          data-tone={line.tone}
          aria-live="polite"
        >
          {line.text}
          {mode.kind === "waiting" && (
            <>
              {" "}
              <a href={mode.url} target="_blank" rel="noopener noreferrer">
                {t("openAgain")}
              </a>
            </>
          )}
        </span>
      </div>
      {status.available &&
        (status.linked ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={disconnect}
          >
            {t("disconnect")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || mode.kind === "waiting"}
            onClick={connect}
          >
            {mode.kind === "expired" ? t("retry") : t("connect")}
          </Button>
        ))}
    </div>
  );
}
