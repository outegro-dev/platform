"use client";

import { cn } from "@outegro/ui/lib/utils";
import type * as React from "react";

type LanguageOption = { value: string; label: string; name: string };

/**
 * Presentational language switch. The app wires `onValueChange` to its
 * locale storage (for outegro.dev: the shared `og_locale` cookie).
 */
function LanguageSwitch({
  value,
  options,
  onValueChange,
  pending = false,
  className,
  ...props
}: Omit<React.ComponentProps<"fieldset">, "onChange"> & {
  value: string;
  options: readonly LanguageOption[];
  onValueChange: (value: string) => void;
  pending?: boolean;
}) {
  return (
    <fieldset
      data-slot="language-switch"
      aria-busy={pending || undefined}
      className={cn(
        "m-0 flex items-center gap-0.5 border-0 p-0 font-mono text-[12px] font-medium transition-opacity duration-(--duration-fast) aria-busy:opacity-60",
        className,
      )}
      {...props}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            lang={option.value}
            // Visible label first so the accessible name contains it (WCAG 2.5.3);
            // an attribute also avoids downloading Cyrillic glyphs on English pages.
            aria-label={`${option.label} — ${option.name}`}
            aria-pressed={active}
            // Not `disabled`: the pressed button keeps keyboard focus.
            aria-disabled={pending || undefined}
            onClick={() => !pending && !active && onValueChange(option.value)}
            className={cn(
              "inline-flex h-11 min-w-9 items-center justify-center rounded-full px-2 transition-colors duration-(--duration-fast) aria-disabled:cursor-progress",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "border-b border-transparent pb-0.5",
                active && "border-current",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

export { type LanguageOption, LanguageSwitch };
