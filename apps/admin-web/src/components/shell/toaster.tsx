"use client";

import {
  CheckCircleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useStores } from "@/stores/provider";

/** Action confirmations in one polite live region, bottom right, no layout shift. */
export const Toaster = observer(function Toaster() {
  "use no memo";
  const { toasts } = useStores();
  const t = useTranslations("common");
  return (
    <section className="toaster" aria-label={t("notifications")}>
      <ul role="status" aria-live="polite" className="stack-sm">
        {toasts.items.map((toast) => (
          <li key={toast.id} className="toast" data-tone={toast.tone}>
            {toast.tone === "ok" ? (
              <CheckCircleIcon aria-hidden="true" weight="fill" />
            ) : (
              <WarningCircleIcon aria-hidden="true" weight="fill" />
            )}
            <span style={{ flex: 1 }}>{toast.text}</span>
            <button
              type="button"
              className="copy-button"
              aria-label={t("dismiss")}
              onClick={() => toasts.dismiss(toast.id)}
            >
              <XIcon aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
});
