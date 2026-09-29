"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Dates render on the server in the operator's own time zone: the browser
 * reports it once in a cookie, and the page re-renders if it changed.
 */
export function TimezoneSync({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === current) return;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie, read by the server.
    document.cookie = `og_tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax${secure}`;
    router.refresh();
  }, [current, router]);
  return null;
}
