"use client";

import { Button } from "@outegro/ui/button";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { revokeOtherSessions } from "../actions";

export function RevokeOthers({ disabled }: { disabled: boolean }) {
  const t = useTranslations("sessions");
  const [state, action, pending] = useActionState(revokeOtherSessions, {});
  return (
    <form action={action} className="form-actions">
      <Button type="submit" variant="outline" disabled={disabled || pending}>
        {t("revokeOthers")}
      </Button>
      <p className="form-status" role="status">
        {state.revoked !== undefined &&
          t("revokedOthers", { count: state.revoked })}
      </p>
    </form>
  );
}
