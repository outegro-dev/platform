"use client";

import { useEffect, useState } from "react";

/**
 * The browser's time zone, after hydration. The server render and the first
 * client render both use UTC, so the markup matches; local times follow.
 */
export function useTimeZone(): string {
  const [zone, setZone] = useState("UTC");
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local) setZone(local);
  }, []);
  return zone;
}
