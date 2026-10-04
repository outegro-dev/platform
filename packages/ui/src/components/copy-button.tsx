"use client";

import { Button } from "@outegro/ui/button";
import { cn } from "@outegro/ui/lib/utils";
import { CheckIcon, CopyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type * as React from "react";
import { useEffect, useState } from "react";

type CopyStatus = "idle" | "copied" | "failed";

/**
 * Writes text to the clipboard and says whether it worked. Never throws:
 * no Clipboard API (an insecure context), a denied permission, an
 * unfocused document or a `value()` that throws all resolve to false.
 */
async function copyText(value: string | (() => string)): Promise<boolean> {
  try {
    const text = typeof value === "function" ? value() : value;
    const clipboard = globalThis.navigator?.clipboard;
    if (typeof clipboard?.writeText !== "function") return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The result of each copy, reported once, then "idle" after `resetAfter`
 * ms. A newer copy wins over an older one still in flight (and restarts the
 * timer); after `dispose()` nothing more is reported.
 */
function createCopyFeedback(onChange: (status: CopyStatus) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  return {
    async copy(
      value: string | (() => string),
      resetAfter = 2000,
    ): Promise<CopyStatus> {
      const attempt = ++latest;
      const status: CopyStatus = (await copyText(value)) ? "copied" : "failed";
      if (attempt !== latest) return status;
      clearTimeout(timer);
      onChange(status);
      timer = setTimeout(() => onChange("idle"), resetAfter);
      return status;
    },
    dispose() {
      latest++;
      clearTimeout(timer);
    },
  };
}

type CopyButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "value" | "children" | "asChild" | "pending" | "pendingLabel" | "type"
> & {
  /** The text, or a function that reads it at the moment of the click. */
  value: string | (() => string);
  /** "Copy" in the page's language; also the name of an icon-only button. */
  label: string;
  /** "Copied" — shown and announced after a successful copy. */
  copiedLabel: string;
  /** "Couldn't copy" — shown and announced when the clipboard refuses. */
  failedLabel: string;
  /** How long the result stays before the label returns, in ms. */
  resetAfter?: number;
};

const icons = {
  idle: <CopyIcon aria-hidden="true" />,
  copied: <CheckIcon aria-hidden="true" weight="bold" />,
  failed: <WarningCircleIcon aria-hidden="true" />,
} as const;

const states = ["idle", "copied", "failed"] as const;

/** Appended to every other result, so a repeated one is announced again. */
const repeatMark = String.fromCharCode(0x200b);

/**
 * Copies `value` and shows the result in place: the icon turns into a check
 * (or a warning), the label into `copiedLabel` (or `failedLabel`), then back
 * after ~2 s. The three icon-and-label pairs share one grid cell, so the
 * button keeps the width of the widest and the visible pair stays centred;
 * hidden pairs are not part of its name. The result is also announced
 * through a polite live region next to it. With size="icon" or "icon-sm"
 * only the icon shows and the labels are its accessible name.
 */
function CopyButton({
  value,
  label,
  copiedLabel,
  failedLabel,
  resetAfter = 2000,
  variant = "ghost",
  size = "sm",
  onClick,
  ...props
}: CopyButtonProps) {
  const [result, setResult] = useState({
    status: "idle" as CopyStatus,
    count: 0,
  });
  const [feedback] = useState(() =>
    createCopyFeedback((status) =>
      setResult((last) => ({
        status,
        count: status === "idle" ? last.count : last.count + 1,
      })),
    ),
  );
  useEffect(() => () => feedback.dispose(), [feedback]);

  const { status } = result;
  const labels = { idle: label, copied: copiedLabel, failed: failedLabel };
  const message = status === "idle" ? "" : labels[status];
  const iconOnly = size === "icon" || size === "icon-sm";
  return (
    <>
      <Button
        variant={variant}
        size={size}
        data-slot="copy-button"
        data-state={status}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) feedback.copy(value, resetAfter);
        }}
        {...props}
        type="button"
      >
        <span
          data-slot="copy-button-content"
          className="grid gap-[inherit] *:col-start-1 *:row-start-1"
        >
          {states.map((state) => (
            <span
              key={state}
              data-state={state}
              className={cn(
                "inline-flex items-center justify-center gap-[inherit]",
                state !== status && "invisible",
              )}
            >
              {icons[state]}
              <span className={iconOnly ? "sr-only" : undefined}>
                {labels[state]}
              </span>
            </span>
          ))}
        </span>
      </Button>
      <span role="status" data-slot="copy-button-status" className="sr-only">
        {message && result.count % 2 === 0 ? message + repeatMark : message}
      </span>
    </>
  );
}

export {
  CopyButton,
  type CopyButtonProps,
  type CopyStatus,
  copyText,
  createCopyFeedback,
};
