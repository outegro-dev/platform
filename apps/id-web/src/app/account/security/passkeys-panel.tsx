"use client";

import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import { FormMessage } from "@outegro/ui/form-message";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { FingerprintIcon } from "@phosphor-icons/react";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useActionStatus } from "@/components/action-status";
import { isOffline } from "@/lib/online";
import { ceremonyError } from "@/lib/passkey-ceremony";
import {
  PASSKEY_NAME_MAX,
  type PasskeyError,
  type PasskeyItem,
  type PasskeyOutcome,
  passkeyName,
} from "@/lib/passkeys";
import {
  passkeyRegistrationOptions,
  registerPasskey,
  removePasskey,
  renamePasskey,
} from "./passkey-actions";

/** A passkey with its dates already written out by the server. */
export type PasskeyRow = PasskeyItem & {
  added: string;
  lastUsed: string | null;
};

const SIGN_IN_AGAIN = `/login?reauth=1&continue=${encodeURIComponent("/account/security")}`;
const SIGNED_OUT = `/login?continue=${encodeURIComponent("/account/security")}`;

/** What the add form says: a hint, a result or a problem. */
type Note =
  | { tone: "neutral" }
  | { tone: "success" }
  | { tone: "error"; error: PasskeyError | "reauth_required" };

/** Outcomes of an action on a listed passkey, as the user reads them. */
function listError(outcome: PasskeyOutcome): PasskeyError {
  return outcome === "reauth_required" ||
    outcome === "signed_out" ||
    outcome === "not_found"
    ? "failed"
    : outcome;
}

/**
 * Passkeys on the Security page (ID-05): add one with a name, rename it,
 * remove it after a confirmation. auth-backend decides everything that
 * matters: a recent sign-in to add, never the last way to sign in removed.
 */
export function PasskeysPanel({
  items,
  suggestedName,
}: {
  items: PasskeyRow[];
  /** A starting name from this device's browser and system. */
  suggestedName: string;
}) {
  const t = useTranslations("passkeys");
  const [name, setName] = useState(suggestedName);
  const [note, setNote] = useState<Note>({ tone: "neutral" });
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  // A removed passkey takes its row, and the focus in it, away: the focus
  // goes to the section instead of the top of the page.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(items.length);
  useEffect(() => {
    if (items.length < shown.current) heading.current?.focus();
    shown.current = items.length;
  }, [items.length]);

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fail = (error: PasskeyError | "reauth_required") =>
      setNote({ tone: "error", error });
    if (isOffline()) return fail("offline");
    if (!browserSupportsWebAuthn()) return fail("unsupported");
    const label = passkeyName.safeParse(name);
    if (!label.success) return fail("invalid_name");
    setNote({ tone: "neutral" });
    startTransition(async () => {
      const begun = await passkeyRegistrationOptions();
      if (!begun.ok) {
        if (begun.error === "signed_out")
          return window.location.assign(SIGNED_OUT);
        return fail(
          begun.error === "reauth_required"
            ? "reauth_required"
            : listError(begun.error),
        );
      }
      let answer: Awaited<ReturnType<typeof startRegistration>>;
      try {
        answer = await startRegistration({ optionsJSON: begun.options });
      } catch (reason) {
        const key = ceremonyError(reason);
        if (key !== "aborted") fail(key);
        return;
      }
      const result = await registerPasskey(
        begun.challengeId,
        label.data,
        answer,
      );
      if (!result.ok) {
        if (result.error === "signed_out")
          return window.location.assign(SIGNED_OUT);
        return fail(listError(result.error));
      }
      setNote({ tone: "success" });
      setName("");
    });
  };

  const message =
    note.tone === "success"
      ? t("added")
      : note.tone === "error"
        ? note.error === "reauth_required"
          ? t("reauth")
          : t(`errors.${note.error}`)
        : t("nameHint");

  return (
    <>
      <div className="panel-head">
        <h2 ref={heading} tabIndex={-1}>
          {t("title")}
        </h2>
        <p className="muted">{t("lead")}</p>
      </div>
      {items.length === 0 ? (
        <p className="muted passkeys-empty">{t("empty")}</p>
      ) : (
        <ul className="methods" aria-label={t("title")}>
          {items.map((item) => (
            <PasskeyEntry key={item.id} item={item} />
          ))}
        </ul>
      )}
      <form className="passkey-add" onSubmit={add} noValidate>
        <div className="field">
          <Label htmlFor={inputId}>{t("name")}</Label>
          <Input
            id={inputId}
            value={name}
            maxLength={PASSKEY_NAME_MAX}
            placeholder={t("namePlaceholder")}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              if (note.tone !== "neutral") setNote({ tone: "neutral" });
            }}
            aria-invalid={
              note.tone === "error" && note.error === "invalid_name"
                ? true
                : undefined
            }
            aria-describedby={`${inputId}-note`}
          />
        </div>
        <div className="form-actions">
          <Button type="submit" pending={pending} pendingLabel={t("adding")}>
            <FingerprintIcon aria-hidden="true" />
            {t("add")}
          </Button>
          <FormMessage
            id={`${inputId}-note`}
            role="status"
            className="form-status items-center"
            lines={2}
            tone={note.tone}
          >
            {note.tone === "error" && note.error === "reauth_required" ? (
              <span>
                {message}{" "}
                <a className="text-link" href={SIGN_IN_AGAIN}>
                  {t("reauthLink")}
                </a>
              </span>
            ) : (
              message
            )}
          </FormMessage>
        </div>
      </form>
    </>
  );
}

function PasskeyEntry({ item }: { item: PasskeyRow }) {
  const t = useTranslations("passkeys");
  return (
    <li className="method passkey">
      <FingerprintIcon aria-hidden="true" />
      <div className="method-text">
        <strong className="passkey-name">
          {item.name}
          {item.synced && <Badge variant="muted">{t("synced")}</Badge>}
        </strong>
        <span>
          {t("createdAt", { date: item.added })}
          {" · "}
          {item.lastUsed
            ? t("lastUsed", { date: item.lastUsed })
            : t("neverUsed")}
        </span>
        {!item.usable && <span>{t("unusable")}</span>}
      </div>
      <div className="method-actions">
        <RenameDialog item={item} />
        <RemoveDialog item={item} />
      </div>
    </li>
  );
}

function RenameDialog({ item }: { item: PasskeyRow }) {
  const t = useTranslations("passkeys");
  const show = useActionStatus();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<PasskeyError | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isOffline()) return setError("offline");
    const label = passkeyName.safeParse(name);
    if (!label.success) return setError("invalid_name");
    startTransition(async () => {
      const result = await renamePasskey(item.id, label.data);
      if (!result.ok) {
        if (result.error === "signed_out")
          return window.location.assign(SIGNED_OUT);
        if (result.error === "not_found") return setOpen(false);
        return setError(listError(result.error));
      }
      setOpen(false);
      show(t("renamed"), "success");
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setName(item.name);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t("rename")}
          <span className="sr-only"> {t("target", { name: item.name })}</span>
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{t("renameTitle")}</DialogTitle>
          <DialogDescription>{t("nameHint")}</DialogDescription>
        </DialogHeader>
        <form className="dialog-form" onSubmit={save} noValidate>
          <div className="field">
            <Label htmlFor={inputId}>{t("name")}</Label>
            <Input
              id={inputId}
              value={name}
              maxLength={PASSKEY_NAME_MAX}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              aria-invalid={error === "invalid_name" || undefined}
              aria-describedby={`${inputId}-error`}
            />
            <FormMessage
              id={`${inputId}-error`}
              role="status"
              lines={2}
              tone={error ? "error" : "neutral"}
            >
              {error ? t(`errors.${error}`) : null}
            </FormMessage>
          </div>
          <div className="dialog-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" pending={pending} pendingLabel={t("saving")}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ item }: { item: PasskeyRow }) {
  const t = useTranslations("passkeys");
  const show = useActionStatus();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<PasskeyError | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (isOffline()) return setError("offline");
    startTransition(async () => {
      const result = await removePasskey(item.id);
      if (!result.ok) {
        if (result.error === "signed_out")
          return window.location.assign(SIGNED_OUT);
        if (result.error !== "not_found")
          return setError(listError(result.error));
      }
      setOpen(false);
      show(t("removed"), "success");
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t("remove")}
          <span className="sr-only"> {t("target", { name: item.name })}</span>
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{t("removeTitle")}</DialogTitle>
          <DialogDescription>
            {t("removeBody", { name: item.name })}
          </DialogDescription>
        </DialogHeader>
        <FormMessage role="status" lines={2} tone={error ? "error" : "neutral"}>
          {error ? t(`errors.${error}`) : null}
        </FormMessage>
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            {t("keep")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            pending={pending}
            pendingLabel={t("removing")}
            onClick={remove}
          >
            {t("confirmRemove")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
