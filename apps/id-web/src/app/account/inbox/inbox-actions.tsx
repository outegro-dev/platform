"use client";

import { Button } from "@outegro/ui/button";
import { Spinner } from "@outegro/ui/spinner";
import { CheckIcon } from "@phosphor-icons/react";
import Link, { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  use,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { useActionStatus, useOfflineGuard } from "@/components/action-status";
import { SubmitButton } from "@/components/submit-button";
import { isOffline } from "@/lib/online";
import { type InboxState, inboxAction } from "../actions";

const Dispatch = createContext<(form: FormData) => void>(() => {});

/** One action for the page, so its result is reported after the refresh. */
export function InboxActions({ children }: { children: ReactNode }) {
  const t = useTranslations("inbox");
  const show = useActionStatus();
  const [state, dispatch] = useActionState<InboxState, FormData>(inboxAction, {
    status: "idle",
  });
  const reported = useRef(state);
  useEffect(() => {
    if (reported.current === state) return;
    reported.current = state;
    if (state.status === "read") show(t("marked"), "success");
    if (state.status === "error") show(t("markFailed"), "error");
  }, [state, show, t]);
  return <Dispatch value={dispatch}>{children}</Dispatch>;
}

/**
 * "Mark as read", and once that worked here, a "Read" note in its place —
 * the same size, so the row keeps its height until the next visit.
 */
export function MarkReadForm({
  itemId,
  read,
}: {
  itemId: string;
  read: boolean;
}) {
  const t = useTranslations("inbox");
  const dispatch = use(Dispatch);
  const guard = useOfflineGuard();
  const [marked, setMarked] = useState(false);
  if (read && !marked) return null;
  if (read)
    return (
      <p className="row-done">
        <span className="invisible" aria-hidden="true">
          {t("markRead")}
        </span>
        <span className="row-done-label">
          <CheckIcon aria-hidden="true" weight="bold" />
          {t("markedShort")}
        </span>
      </p>
    );
  return (
    <form
      action={dispatch}
      onSubmit={(event) => {
        guard(event);
        if (!isOffline()) setMarked(true);
      }}
    >
      <input type="hidden" name="itemId" value={itemId} />
      <SubmitButton variant="ghost" size="sm" pendingLabel={t("marking")}>
        {t("markRead")}
      </SubmitButton>
    </form>
  );
}

function PendingLabel({
  children,
  pendingLabel,
}: {
  children: ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        className={
          pending
            ? "invisible inline-flex items-center gap-[inherit]"
            : "contents"
        }
        aria-hidden={pending || undefined}
      >
        {children}
      </span>
      {pending && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center"
          >
            <Spinner />
          </span>
          <span className="sr-only">{pendingLabel}</span>
        </>
      )}
    </>
  );
}

/** Pager link: a spinner over the kept label while the next page loads. */
export function PagerLink({
  href,
  variant,
  children,
}: {
  href: string;
  variant: "ghost" | "outline";
  children: string;
}) {
  const t = useTranslations("inbox");
  const guard = useOfflineGuard();
  return (
    <Button asChild variant={variant} className="relative">
      <Link href={href} onClick={guard}>
        <PendingLabel pendingLabel={t("loadingPage")}>{children}</PendingLabel>
      </Link>
    </Button>
  );
}
