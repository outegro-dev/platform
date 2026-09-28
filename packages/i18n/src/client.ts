"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "./actions";

/** Switch language without changing the URL: write the cookie, re-render on the server. */
export function useLocaleSwitch() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (next: string) =>
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  return { locale, change, pending };
}
