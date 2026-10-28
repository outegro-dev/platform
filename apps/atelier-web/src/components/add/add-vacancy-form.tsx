"use client";

import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import {
  CheckCircleIcon,
  LinkIcon,
  TextAlignLeftIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState, useTransition } from "react";
import { useFailureText } from "@/components/chrome/action-status";
import { writeApi } from "@/lib/client-api";
import { applicationHref } from "@/lib/routes";
import type { AddVacancyResponse } from "@/lib/schemas";
import {
  readVacancyInput,
  type VacancyInput,
  vacancyRequest,
} from "@/lib/vacancy";

type Problem = VacancyInput["kind"] | "refused" | "failed" | "offline" | null;

/**
 * One field for a link or the vacancy's text. It says what it recognised
 * while you type, and checks on submit: an empty field, a broken link, a
 * text that is too short or too long each get their own message.
 */
export function AddVacancyForm() {
  const t = useTranslations("add");
  const failureText = useFailureText();
  const router = useRouter();
  const ids = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = readVacancyInput(value);

  const messages: Partial<Record<NonNullable<Problem>, string>> = {
    empty: t("errors.empty"),
    "bad-url": t("errors.url"),
    short: t("errors.short", {
      count: input.kind === "short" ? input.length : 0,
    }),
    long: t("errors.long"),
    refused: t("errors.refused"),
    failed: t("errors.failed"),
    offline: failureText("offline"),
  };
  const message = problem ? (messages[problem] ?? null) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const request = vacancyRequest(input);
    if (!request) {
      setProblem(
        input.kind === "url" || input.kind === "text" ? "failed" : input.kind,
      );
      field.current?.focus();
      return;
    }
    setProblem(null);
    startTransition(async () => {
      const result = await writeApi<AddVacancyResponse>(
        "POST",
        "/vacancies",
        request,
      );
      // The backend answers with the ingest job; the card appears on the
      // board once the vacancy is read, so without an id the link is the pipeline.
      if (result.ok && (result.data?.applicationId || result.data?.jobId)) {
        setAdded(result.data.applicationId ?? "pipeline");
        router.refresh();
        return;
      }
      setProblem(
        result.ok
          ? "failed"
          : result.failure === "invalid"
            ? "refused"
            : result.failure === "offline"
              ? "offline"
              : "failed",
      );
    });
  };

  if (added)
    return (
      <div className="add-done" role="status">
        <CheckCircleIcon
          aria-hidden="true"
          weight="fill"
          className="add-done-icon"
        />
        <div className="add-done-text">
          <h2 className="add-done-title">{t("done")}</h2>
          <p>{t("doneBody")}</p>
          <div className="add-done-actions">
            <Button asChild size="md">
              <Link
                href={
                  added === "pipeline" ? "/pipeline" : applicationHref(added)
                }
                scroll={false}
              >
                {t("open")}
              </Link>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setAdded(null);
                setValue("");
                window.setTimeout(() => field.current?.focus(), 0);
              }}
            >
              {t("another")}
            </Button>
          </div>
        </div>
      </div>
    );

  const detected =
    input.kind === "url"
      ? { Icon: LinkIcon, text: t("detectedUrl", { host: input.host }) }
      : input.kind === "text" || input.kind === "short" || input.kind === "long"
        ? {
            Icon: TextAlignLeftIcon,
            text: t("detectedText", { count: input.length }),
          }
        : null;

  return (
    <form className="add-form" onSubmit={submit} noValidate>
      <div className="add-field">
        <label className="field-label" htmlFor={`${ids}-vacancy`}>
          {t("label")}
        </label>
        <p className="field-hint" id={`${ids}-hint`}>
          {t("hint")}
        </p>
        <textarea
          ref={field}
          id={`${ids}-vacancy`}
          name="vacancy"
          className="text-area"
          rows={9}
          value={value}
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${ids}-hint ${ids}-detected ${ids}-error`}
          onChange={(event) => {
            setValue(event.target.value);
            if (problem) setProblem(null);
          }}
        />
        <p className="field-detected" id={`${ids}-detected`}>
          {detected ? (
            <>
              <detected.Icon aria-hidden="true" weight="bold" />
              {detected.text}
            </>
          ) : null}
        </p>
        <FormMessage
          id={`${ids}-error`}
          tone={problem ? "error" : "neutral"}
          lines={2}
          aria-live="polite"
        >
          {message}
        </FormMessage>
      </div>
      <Button
        type="submit"
        size="lg"
        pending={pending}
        pendingLabel={t("submitting")}
      >
        {t("submit")}
      </Button>
    </form>
  );
}
