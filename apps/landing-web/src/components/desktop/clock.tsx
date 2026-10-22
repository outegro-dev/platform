"use client";

import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

/** The taskbar clock: the visitor's own time in the page's language, set
 * once mounted. */
export function Clock() {
  const locale = useLocale();
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [locale]);
  return <span className="xp-clock">{now}</span>;
}
