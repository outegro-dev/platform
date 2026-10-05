"use server";

import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { clearSession, REFRESH_COOKIE } from "@outegro/bff/session";
import { endSession } from "@outegro/bff/sso";
import {
  attemptResultSchema,
  bookSlugSchema,
  cardIdSchema,
  cardStateSchema,
  exerciseAttemptSchema,
  exerciseIdSchema,
  explainKindSchema,
} from "@outegro/contracts/edu";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { accessToken, eduApi } from "@/lib/api";
import { fitsBody } from "@/lib/body-size";
import { env } from "@/lib/env";
import type {
  AttemptInput,
  AttemptOutcome,
  CardInput,
  PositionInput,
  WriteFailure,
  WriteOutcome,
} from "@/lib/reader-api";

/*
 * The reader's writes to edu-backend: attempts at exercises (the server
 * checks them and decides), flash card marks, the last chapter and the
 * preferred explanation view; and sign-out. The browser calls these server
 * actions (same origin only); only the server sees the access token in the
 * og_at cookie. Input is validated here: the browser sends intent, never a
 * verdict.
 */

/** Maps a failed call to what the page can do about it. */
function failureOf(error: unknown): WriteFailure {
  if (error instanceof BackendError) {
    if (error.status === 401) return "signed-out";
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "not-found";
    if (error.status === 413) return "too-large";
    if (error.status === 400 || error.status === 409 || error.status === 422)
      return "invalid";
  }
  return "failed";
}

/**
 * Logs an outcome that is not an ordinary one: the page shows a message
 * the reader may miss, and without this line a refused write leaves no
 * trace. The action and the outcome only: no token, no answer.
 */
function logged<const T extends { kind: string }>(
  action: string,
  outcome: T,
): T {
  if (outcome.kind !== "ok" && outcome.kind !== "signed-out")
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "server action did not succeed",
        action,
        outcome: outcome.kind,
      }),
    );
  return outcome;
}

const attemptInput = z
  .object({
    slug: bookSlugSchema,
    id: exerciseIdSchema,
    attempt: exerciseAttemptSchema,
    idempotencyKey: z.uuid(),
  })
  .strict();

/**
 * Sends an answer to edu-backend, which checks it against the book and
 * records it. The Idempotency-Key makes a retry of the same attempt safe:
 * the server returns the stored verdict and does not count it again. An
 * answer larger than edu-backend takes (an SQL task's result) is "too
 * large" for good: it is not sent, and no retry of it could ever pass.
 */
export async function submitAttempt(
  input: AttemptInput,
): Promise<AttemptOutcome> {
  const parsed = attemptInput.safeParse(input);
  if (!parsed.success) return logged("submitAttempt", { kind: "invalid" });
  const { slug, id, attempt, idempotencyKey } = parsed.data;
  if (!fitsBody(attempt)) return logged("submitAttempt", { kind: "too-large" });
  const token = await accessToken();
  if (!token) return { kind: "signed-out" };
  try {
    const raw = await eduApi<unknown>(
      `/v1/me/books/${slug}/exercises/${id}/attempts`,
      {
        method: "POST",
        accessToken: token,
        body: attempt,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    const result = attemptResultSchema.safeParse(raw);
    if (!result.success) {
      console.error("[bff] an attempt answered outside the contract");
      return logged("submitAttempt", { kind: "failed" });
    }
    return { kind: "ok", ...result.data };
  } catch (error) {
    if (!(error instanceof BackendError || error instanceof BackendUnavailable))
      console.error("[bff] an attempt failed", error);
    return logged("submitAttempt", { kind: failureOf(error) });
  }
}

const cardInput = z
  .object({
    slug: bookSlugSchema,
    id: cardIdSchema,
    state: cardStateSchema,
    idempotencyKey: z.uuid(),
  })
  .strict();

/** "I know it" or "again" for a flash card; a retry with the same key is safe. */
export async function saveCard(input: CardInput): Promise<WriteOutcome> {
  const parsed = cardInput.safeParse(input);
  if (!parsed.success) return logged("saveCard", { kind: "invalid" });
  const token = await accessToken();
  if (!token) return { kind: "signed-out" };
  const { slug, id, state, idempotencyKey } = parsed.data;
  try {
    await eduApi<unknown>(`/v1/me/books/${slug}/cards/${id}`, {
      method: "PUT",
      accessToken: token,
      body: { state },
      headers: { "Idempotency-Key": idempotencyKey },
    });
    return { kind: "ok" };
  } catch (error) {
    return logged("saveCard", { kind: failureOf(error) });
  }
}

const positionInput = z
  .object({
    slug: bookSlugSchema,
    lastChapter: z.number().int().positive().max(999).optional(),
    explainView: explainKindSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.lastChapter !== undefined || value.explainView !== undefined,
  );

/** Where the reader is (last chapter) and how they like things explained. */
export async function savePosition(
  input: PositionInput,
): Promise<WriteOutcome> {
  const parsed = positionInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const token = await accessToken();
  if (!token) return { kind: "signed-out" };
  const { slug, ...position } = parsed.data;
  try {
    await eduApi<unknown>(`/v1/me/books/${slug}/progress`, {
      method: "PATCH",
      accessToken: token,
      body: position,
    });
    return { kind: "ok" };
  } catch (error) {
    return { kind: failureOf(error) };
  }
}

/** Ends this app's session in Identity, forgets the cookies, back home. */
export async function signOut() {
  const jar = await cookies();
  await endSession(
    env.AUTH_API_URL,
    jar.get(REFRESH_COOKIE)?.value,
    clientHeaders(await headers(), env.CLIENT_IP_SOURCE),
  );
  clearSession(jar);
  redirect("/");
}
