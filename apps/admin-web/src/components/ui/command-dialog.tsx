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
import {
  ArrowLeftIcon,
  CircleNotchIcon,
  EyeIcon,
  InfoIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { ActionResult, CommandResult } from "@/lib/actions";
import { useOnline } from "@/lib/online";
import { isUnsent, sendAction, type Unsent } from "@/lib/send-action";
import { useStores } from "@/stores/provider";

export type CommandAction<P> = (form: FormData) => Promise<CommandResult<P>>;

type Props<P> = {
  action: CommandAction<P>;
  triggerLabel: string;
  triggerIcon?: ReactNode;
  triggerVariant?: "primary" | "outline" | "ghost" | "destructive";
  title: string;
  description?: string;
  /** Standing notes about the command, shown while it is being filled in. */
  consequences?: string[];
  confirmLabel: string;
  destructive?: boolean;
  /** Ids and versions of the target, posted as hidden fields. */
  hidden?: Record<string, string>;
  /** The command's own fields (the caller keeps their state). */
  children?: ReactNode;
  /** The fields are complete and valid: the preview may be asked for. */
  ready?: boolean;
  /** The service's answer to the preview, in the operator's words. */
  renderPreview: (preview: P) => ReactNode;
  /** The preview changes nothing: there is nothing to confirm. */
  unchanged?: (preview: P) => boolean;
};

/**
 * A command the service previews before it runs. Step one: the fields and a
 * typed reason, sent with `intent=preview`; the service answers what would
 * change and nothing changes yet. Step two: that answer, and the confirm
 * button sends exactly the same form with `intent=confirm`. Editing goes
 * back to step one, so a confirmed command is always the one previewed.
 * Offline, or without an answer from the server, nothing typed is lost.
 */
export function CommandDialog<P>(props: Props<P>) {
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
        <Button variant={props.triggerVariant ?? "outline"} size="sm">
          {props.triggerIcon}
          {props.triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="dialog" closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? (
            <DialogDescription>{props.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              {props.confirmLabel}
            </DialogDescription>
          )}
        </DialogHeader>
        <CommandForm key={attempt} {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

type Shown<P> = CommandResult<P> | Unsent | { status: "idle" };

const copyOf = (data: FormData, intent: "preview" | "confirm") => {
  const copy = new FormData();
  for (const [name, value] of data.entries()) copy.append(name, value);
  copy.set("intent", intent);
  return copy;
};

function CommandForm<P>({
  action,
  consequences,
  confirmLabel,
  destructive,
  hidden,
  children,
  ready = true,
  renderPreview,
  unchanged,
  triggerIcon,
  onDone,
}: Props<P> & { onDone: () => void }) {
  const t = useTranslations("actions");
  const id = useId();
  const { toasts } = useStores();
  const online = useOnline();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<Shown<P>>({ status: "idle" });
  // The form exactly as previewed: confirming sends this, nothing newer.
  const [previewed, setPreviewed] = useState<{
    data: FormData;
    preview: P;
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const length = reason.trim().length;
  const valid = ready && length >= 3 && length <= 500;

  useEffect(() => {
    if (previewed) heading.current?.focus();
  }, [previewed]);

  const send = async (data: FormData) => {
    setPending(true);
    const result = await sendAction(
      () => action(data),
      () => navigator.onLine,
    );
    setPending(false);
    return result;
  };

  const askPreview = async (data: FormData) => {
    const result = await send(copyOf(data, "preview"));
    if (result.status === "preview") {
      setPreviewed({ data, preview: result.preview });
      setShown({ status: "idle" });
      return;
    }
    if (result.status === "error" && refreshes(result))
      toasts.push("bad", result.message);
    setShown(result);
  };

  const confirm = async () => {
    if (!previewed) return;
    const result = await send(copyOf(previewed.data, "confirm"));
    if (result.status === "success") {
      // The page re-renders with fresh data and may drop this dialog.
      toasts.push("ok", result.message);
      onDone();
      return;
    }
    if (result.status === "error" && refreshes(result)) {
      // The page now shows the current state: preview again against it.
      toasts.push("bad", result.message);
      setPreviewed(null);
    }
    setShown(result);
  };

  const unsent = isUnsent(shown) ? shown.status : null;
  const line =
    shown.status === "error"
      ? shown.message
      : unsent === "failed"
        ? t("failed")
        : unsent === "offline"
          ? online
            ? t("backOnline")
            : t("offline")
          : "";
  const status = (
    <div className="form-outcome">
      <p
        className="form-status"
        role="status"
        aria-live="polite"
        data-tone={
          shown.status === "error" || unsent === "failed"
            ? "bad"
            : unsent === "offline"
              ? "warn"
              : undefined
        }
      >
        {unsent === "offline" && !online && (
          <WifiSlashIcon aria-hidden="true" />
        )}
        {unsent === "failed" && <WarningCircleIcon aria-hidden="true" />}
        {line}
      </p>
    </div>
  );

  if (previewed) {
    const nothing = unchanged?.(previewed.preview) ?? false;
    return (
      <div className="dialog-form">
        <section className="command-preview" aria-labelledby={`${id}-preview`}>
          <h3
            id={`${id}-preview`}
            ref={heading}
            tabIndex={-1}
            className="command-preview-title"
          >
            {t("previewTitle")}
          </h3>
          {renderPreview(previewed.preview)}
          {nothing && <p className="small muted">{t("previewNothing")}</p>}
        </section>
        <p className="small">
          <span className="muted">{t("reason")}: </span>“{reason.trim()}”
        </p>
        {status}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setPreviewed(null);
              setShown({ status: "idle" });
            }}
          >
            <ArrowLeftIcon aria-hidden="true" />
            {t("edit")}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "primary"}
            className="btn-fixed"
            disabled={pending || nothing}
            aria-busy={pending || undefined}
            onClick={() => void confirm()}
          >
            {pending ? (
              <CircleNotchIcon aria-hidden="true" className="spin" />
            ) : (
              triggerIcon
            )}
            {confirmLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    // Sent by hand: a form reset after the action would lose what was typed.
    <form
      className="dialog-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || pending) return;
        void askPreview(new FormData(event.currentTarget));
      }}
    >
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {consequences && consequences.length > 0 && (
        <ul className="consequences" aria-label={t("whatHappens")}>
          {consequences.map((text) => (
            <li key={text}>
              <InfoIcon aria-hidden="true" />
              <span>{text}</span>
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
      {status}
      <div className="dialog-actions">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          className="btn-fixed"
          disabled={!valid || pending}
          aria-busy={pending || undefined}
        >
          {pending ? (
            <CircleNotchIcon aria-hidden="true" className="spin" />
          ) : (
            <EyeIcon aria-hidden="true" />
          )}
          {t("preview")}
        </Button>
      </div>
    </form>
  );
}

/** Refusals after which the page re-rendered with the current state. */
const refreshes = (result: ActionResult & { status: "error" }) =>
  result.code === "version-conflict" ||
  result.code === "conflict" ||
  result.code === "round-closed";
