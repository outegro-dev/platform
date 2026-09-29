"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import { CircleNotchIcon, InfoIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useState,
} from "react";
import type { ActionResult } from "@/lib/actions";
import { useStores } from "@/stores/provider";

type ServerAction = (
  state: ActionResult,
  form: FormData,
) => Promise<ActionResult>;

type Props = {
  action: ServerAction;
  triggerLabel: string;
  triggerIcon?: ReactNode;
  triggerVariant?:
    | "primary"
    | "outline"
    | "ghost"
    | "destructive"
    | "secondary";
  triggerSize?: "sm" | "md";
  title: string;
  description?: string;
  /** What will happen, shown before the operator confirms (preview). */
  consequences?: string[];
  confirmLabel: string;
  destructive?: boolean;
  /** Ids of the target, posted as hidden fields. */
  hidden?: Record<string, string>;
  /** Extra fields (role, expiry…), rendered above the reason. */
  children?: ReactNode;
  /** A checkbox the operator must tick (e.g. resend an "unknown" message). */
  acknowledge?: { name: string; label: string };
};

/**
 * Preview → confirm with a typed reason → server action. The dialog lists
 * the consequences, the confirm button stays disabled until the reason is
 * long enough, errors land in a reserved line, and success closes the
 * dialog with a toast while the page re-renders with fresh data.
 */
export function ActionDialog(props: Props) {
  const t = useTranslations("actions");
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setAttempt((value) => value + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={props.triggerVariant ?? "outline"}
          size={props.triggerSize ?? "sm"}
        >
          {props.triggerIcon}
          {props.triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="dialog" closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle className="text-[26px] tracking-[-0.035em]">
            {props.title}
          </DialogTitle>
          {props.description ? (
            <DialogDescription>{props.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              {props.confirmLabel}
            </DialogDescription>
          )}
        </DialogHeader>
        <ActionForm key={attempt} {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ActionForm({
  action,
  consequences,
  confirmLabel,
  destructive,
  hidden,
  children,
  acknowledge,
  triggerIcon,
  onDone,
}: Props & { onDone: () => void }) {
  const t = useTranslations("actions");
  const id = useId();
  const { toasts } = useStores();
  // The action re-renders the page, which may replace this very dialog (the
  // match is no longer live, the channel is paused): outcomes that must be
  // seen go to the console-wide toasts, which outlive the dialog.
  const run = async (previous: ActionResult, form: FormData) => {
    const result = await action(previous, form);
    if (result.status === "success") toasts.push("ok", result.message);
    else if (
      result.status === "error" &&
      (result.code === "version-conflict" || result.code === "conflict")
    )
      toasts.push("bad", result.message);
    return result;
  };
  const [state, formAction, pending] = useActionState(run, {
    status: "idle",
  } as ActionResult);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const length = reason.trim().length;
  const valid = length >= 3 && length <= 500 && (!acknowledge || acknowledged);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="dialog-form">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {consequences && consequences.length > 0 && (
        <ul className="consequences" aria-label={t("whatHappens")}>
          {consequences.map((line) => (
            <li key={line}>
              <InfoIcon aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-reason`}>
          {t("reason")}
        </label>
        <textarea
          id={`${id}-reason`}
          name="reason"
          className="textarea"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={3}
          maxLength={500}
          aria-describedby={`${id}-hint`}
          placeholder={t("reasonPlaceholder")}
        />
        <div className="field-foot">
          <span id={`${id}-hint`} className="muted">
            {t("reasonHint")}
          </span>
          <span className="muted num" aria-hidden="true">
            {length}/500
          </span>
        </div>
      </div>
      {acknowledge && (
        <label className="check-field">
          <input
            type="checkbox"
            name={acknowledge.name}
            value="true"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>{acknowledge.label}</span>
        </label>
      )}
      <p
        className="form-status"
        role="status"
        aria-live="polite"
        data-tone={state.status === "error" ? "bad" : undefined}
      >
        {state.status === "error" ? state.message : ""}
      </p>
      <div className="dialog-actions">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant={destructive ? "destructive" : "primary"}
          className="btn-fixed"
          disabled={!valid || pending}
          aria-busy={pending || undefined}
        >
          {pending ? (
            <CircleNotchIcon aria-hidden="true" className="spin" />
          ) : (
            triggerIcon
          )}
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
