"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@outegro/ui/dialog";
import { ClockCountdownIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { type IdleEffects, IdleSessionStore } from "@/stores/idle-store";

const CHANNEL = "og-admin-idle";
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Signs the operator out after 30 idle minutes, across every open tab,
 * with a countdown warning two minutes before. The server enforces the
 * same limit on its side (src/proxy.ts), so a sleeping tab cannot extend it.
 */
export const IdleGuard = observer(function IdleGuard() {
  "use no memo";
  const t = useTranslations("idle");
  const form = useRef<HTMLFormElement>(null);
  const [runtime] = useState(() => {
    const effects: IdleEffects = {
      keepalive: () => undefined,
      signOut: () => undefined,
      broadcast: () => undefined,
    };
    return { effects, store: new IdleSessionStore(effects, Date.now()) };
  });
  const { store, effects } = runtime;

  useEffect(() => {
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(CHANNEL);
    effects.keepalive = () => {
      void fetch("/api/keepalive", {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
      }).catch(() => undefined);
    };
    effects.signOut = () => {
      channel?.postMessage({ type: "signed-out" });
      form.current?.requestSubmit();
    };
    effects.broadcast = (at) => channel?.postMessage({ type: "activity", at });
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; at?: number } | null;
      if (data?.type === "activity" && typeof data.at === "number")
        store.remoteActivity(data.at);
      if (data?.type === "signed-out")
        window.location.assign("/sign-in?reason=idle");
    };
    channel?.addEventListener("message", onMessage);
    const onActivity = () => store.activity(Date.now());
    for (const name of ACTIVITY_EVENTS)
      window.addEventListener(name, onActivity, {
        passive: true,
        capture: true,
      });
    const timer = window.setInterval(() => store.tick(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      for (const name of ACTIVITY_EVENTS)
        window.removeEventListener(name, onActivity, { capture: true });
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [store, effects]);

  return (
    <>
      <Dialog
        open={store.warning}
        onOpenChange={(open) => {
          if (!open) store.extend(Date.now());
        }}
      >
        <DialogContent
          role="alertdialog"
          showCloseButton={false}
          className="dialog"
        >
          <DialogHeader>
            <span className="state-icon" aria-hidden="true">
              <ClockCountdownIcon />
            </span>
            <DialogTitle className="text-[26px] tracking-[-0.035em]">
              {t("title")}
            </DialogTitle>
            <DialogDescription>
              {t("body", { time: clock(store.secondsLeft) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => form.current?.requestSubmit()}
            >
              {t("signOut")}
            </Button>
            <Button autoFocus onClick={() => store.extend(Date.now())}>
              {t("stay")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <form ref={form} method="post" action="/auth/sign-out" hidden>
        <input type="hidden" name="reason" value="idle" />
      </form>
    </>
  );
});
