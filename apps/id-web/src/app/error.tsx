"use client";

import { useTranslations } from "next-intl";
import { ErrorNotice } from "@/components/error-notice";

/**
 * Outside the account pages (sign-in, SSO entry) an unreachable service
 * shows a retry instead of Next.js' bare error screen.
 */
export default function RootError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  const brand = useTranslations("brand");
  return (
    <div className="login-shell og-container">
      <header className="brand-header">
        <a href="/account" className="brand" aria-label={brand("home")}>
          <span className="brand-word">outegro</span>
          <span className="brand-product og-eyebrow">{brand("product")}</span>
        </a>
      </header>
      <ErrorNotice retry={retry} landmark />
    </div>
  );
}
