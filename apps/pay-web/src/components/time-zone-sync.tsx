"use client";

import { useRouter } from "next/navigation";
import { useTimeZone } from "next-intl";
import { useEffect } from "react";
import { timeZoneCookie } from "@/lib/time-zone";

const SYNCED = "og_tz_synced";

/**
 * Tells the server the browser's time zone (cookie `og_tz`) and re-renders
 * once, so dates show in the viewer's zone and stay identical between the
 * server and the browser afterwards. At most one refresh per zone and tab,
 * even if the server does not know the zone.
 */
export function TimeZoneSync() {
  const serverZone = useTimeZone();
  const router = useRouter();

  useEffect(() => {
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone || zone === serverZone) return;
    const cookie = timeZoneCookie(zone, window.location.protocol === "https:");
    if (!cookie) return;
    let refresh = true;
    try {
      if (window.sessionStorage.getItem(SYNCED) === zone) return;
      window.sessionStorage.setItem(SYNCED, zone);
    } catch {
      // Storage blocked: set the cookie, but without the loop guard no refresh.
      refresh = false;
    }
    // biome-ignore lint/suspicious/noDocumentCookie: a plain first-party preference cookie; the Cookie Store API is not in every supported browser yet.
    document.cookie = cookie;
    if (refresh) router.refresh();
  }, [serverZone, router]);

  return null;
}
