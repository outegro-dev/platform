"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/** An id with a copy button; "Copied" is announced, the width never changes. */
export function CopyText({
  value,
  display,
  label,
}: {
  value: string;
  display?: string;
  label?: string;
}) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy">
      <span className="mono truncate" title={value}>
        {display ?? value}
      </span>
      <button
        type="button"
        className="copy-button"
        aria-label={label ?? t("copy")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" role="status">
        {copied ? t("copied") : ""}
      </span>
    </span>
  );
}
