"use client";

import { Button } from "@outegro/ui/button";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { revokeOtherSessions } from "../actions";

/** Shown only while other sessions exist; the refreshed list is the confirmation. */
export function RevokeOthers() {
  const t = useTranslations("sessions");
  const [, action, pending] = useActionState(revokeOtherSessions, {});
  return (
    <form action={action} className="form-actions">
      <Button type="submit" variant="outline" disabled={pending}>
        {t("revokeOthers")}
      </Button>
    </form>
  );
}
