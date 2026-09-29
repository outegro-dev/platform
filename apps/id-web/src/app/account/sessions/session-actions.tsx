"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  use,
  useActionState,
  useEffect,
  useRef,
} from "react";
import { useActionStatus, useOfflineGuard } from "@/components/action-status";
import { SubmitButton } from "@/components/submit-button";
import { type SessionsState, sessionsAction } from "../actions";

const Dispatch = createContext<(form: FormData) => void>(() => {});

/**
 * One action for the whole page: it outlives the row that was signed out, so
 * the result is still reported after the refreshed list has arrived.
 */
export function SessionActions({ children }: { children: ReactNode }) {
  const t = useTranslations("sessions");
  const show = useActionStatus();
  const [state, dispatch] = useActionState<SessionsState, FormData>(
    sessionsAction,
    { status: "idle" },
  );
  const reported = useRef(state);
  useEffect(() => {
    if (reported.current === state) return;
    reported.current = state;
    if (state.status === "revoked")
      show(t("revoked", { device: state.device }), "success");
    if (state.status === "revokedOthers")
      show(t("revokedOthers", { count: state.count }), "success");
    if (state.status === "error") show(t("revokeFailed"), "error");
  }, [state, show, t]);
  return <Dispatch value={dispatch}>{children}</Dispatch>;
}

export function RevokeSessionForm({
  sessionId,
  device,
}: {
  sessionId: string;
  device: string;
}) {
  const t = useTranslations("sessions");
  const dispatch = use(Dispatch);
  const guard = useOfflineGuard();
  return (
    <form action={dispatch} onSubmit={guard}>
      <input type="hidden" name="intent" value="revoke" />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="device" value={device} />
      <SubmitButton variant="ghost" size="sm" pendingLabel={t("revoking")}>
        {t("revoke")}
        <span className="sr-only"> {t("revokeTarget", { device })}</span>
      </SubmitButton>
    </form>
  );
}

export function RevokeOthersForm() {
  const t = useTranslations("sessions");
  const dispatch = use(Dispatch);
  const guard = useOfflineGuard();
  return (
    <form action={dispatch} onSubmit={guard}>
      <input type="hidden" name="intent" value="revoke-others" />
      <SubmitButton variant="outline" pendingLabel={t("revokingOthers")}>
        {t("revokeOthers")}
      </SubmitButton>
    </form>
  );
}
