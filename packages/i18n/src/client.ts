"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "./actions";

/**
 * Switch language without changing the URL: write the cookie, re-render on
 * the server. A failed switch (offline, server unreachable) keeps the current
 * language and calls `onError` instead of breaking the page.
 */
export function useLocaleSwitch({
  onError,
}: {
  onError?: (error: unknown) => void;
} = {}) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (next: string) =>
    startTransition(async () => {
      try {
        await setLocale(next);
      } catch (error) {
        onError?.(error);
        return;
      }
      router.refresh();
    });
  return { locale, change, pending };
}
