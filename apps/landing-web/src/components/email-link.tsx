"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { email } from "@/lib/contact";

const subscribe = () => () => {};
const mailto = () => `mailto:${email.user}@${email.domain}`;
const none = () => undefined;

/**
 * A mail link whose server HTML never holds the whole address: the mailto
 * href appears only after hydration and the text goes through EmailAddress,
 * so Cloudflare has nothing to obfuscate.
 */
export function EmailLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const href = useSyncExternalStore(subscribe, mailto, none);
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** The address as text, the "@" in its own element. */
export function EmailAddress({ className }: { className?: string }) {
  return (
    <span className={className}>
      {email.user}
      <span>@</span>
      {email.domain}
    </span>
  );
}
