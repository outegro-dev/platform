"use client";

import { SignOutIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useOfflineGuard } from "./action-status";
import { SubmitButton } from "./submit-button";

/**
 * The server action stays the form's own action, so signing out also works
 * without JavaScript; with it, the button shows progress and an offline
 * click is explained instead of failing.
 */
export function SignOutForm({ action }: { action: () => Promise<void> }) {
  const t = useTranslations("nav");
  const guard = useOfflineGuard();
  return (
    <form action={action} onSubmit={guard}>
      <SubmitButton variant="outline" size="sm" pendingLabel={t("signingOut")}>
        <SignOutIcon />
        {t("signOut")}
      </SubmitButton>
    </form>
  );
}
