"use client";

import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import { CircleHalfIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { THEME_COOKIE } from "@/lib/constants";
import { type ThemeChoice, themeChoiceOf } from "@/lib/theme";

/** Light, dark or as the system: kept in a cookie, applied at once. */
export function ThemeSwitch({ initial }: { initial: ThemeChoice }) {
  const t = useTranslations("nav");
  // The document knows the latest choice (a sheet mounts long after the
  // server rendered `initial`); on hydration both say the same.
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    typeof document === "undefined"
      ? initial
      : themeChoiceOf(
          document.documentElement.getAttribute("data-theme-choice") ??
            undefined,
        ),
  );
  const choose = (next: string) => {
    const value = themeChoiceOf(next);
    setChoice(value);
    const root = document.documentElement;
    root.setAttribute("data-theme-choice", value);
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie, read by the server.
    document.cookie =
      value === "system"
        ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`
        : `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
    const apply = (window as { __atelierTheme?: () => void }).__atelierTheme;
    if (apply) apply();
    else if (value === "dark") root.setAttribute("data-tone", "dark");
    else root.removeAttribute("data-tone");
  };
  const options = [
    { value: "system", icon: CircleHalfIcon },
    { value: "light", icon: SunIcon },
    { value: "dark", icon: MoonIcon },
  ] as const;
  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      size="sm"
      value={choice}
      onValueChange={choose}
      aria-label={t("theme")}
      className="theme-switch"
    >
      {options.map(({ value, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={t(`themes.${value}`)}
          title={t(`themes.${value}`)}
        >
          <Icon aria-hidden="true" weight="bold" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
