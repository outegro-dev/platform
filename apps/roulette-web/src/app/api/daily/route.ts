import { randomBytes } from "node:crypto";
import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { isSecureRequest } from "@outegro/bff/session";
import {
  dailyClaimSchema,
  dailyStatusSchema,
  deviceIdHeader,
  deviceIdSchema,
} from "@outegro/contracts/daily-bonus";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { accessToken } from "@/lib/api";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  dailyFailure,
} from "@/lib/daily";
import { env } from "@/lib/env";
import { fromThisApp } from "@/lib/sso";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

const dailyApi = createBackend(env.DAILY_API_URL, {
  headers: async () => clientHeaders(await headers(), env.CLIENT_IP_SOURCE),
});

/** The bonus of the day: whether it can be taken, when, and the prize table. */
export function GET(request: NextRequest) {
  return relay(request, "GET", "/v1/daily", dailyStatusSchema);
}

/** Takes the bonus; the ribbon then stops on `prizes[prizeIndex]`. */
export function POST(request: NextRequest) {
  if (!fromThisApp(request))
    return Promise.resolve(
      NextResponse.json(
        { error: "unavailable" },
        { status: 403, headers: noStore },
      ),
    );
  return relay(request, "POST", "/v1/daily/claim", dailyClaimSchema);
}

/**
 * Calls daily-bonus-backend with the session's access token, the browser's
 * address and this browser's device id, which lives in an HttpOnly cookie
 * set here when missing (32 random bytes, a year). The device id only
 * limits bonuses per device; it identifies nobody by itself.
 */
async function relay(
  request: NextRequest,
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType,
): Promise<NextResponse> {
  const stored = request.cookies.get(DEVICE_COOKIE)?.value;
  const known = deviceIdSchema.safeParse(stored);
  const device = known.success
    ? known.data
    : randomBytes(32).toString("base64url");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: noStore });
    if (!known.success)
      response.cookies.set(DEVICE_COOKIE, device, {
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureRequest(request.headers, request.url),
        maxAge: DEVICE_COOKIE_MAX_AGE,
        path: "/",
      });
    return response;
  };

  const token = await accessToken();
  if (!token) {
    const failure = dailyFailure(401);
    return respond(failure.body, failure.status);
  }
  try {
    const raw = await dailyApi<unknown>(path, {
      method,
      accessToken: token,
      body: method === "POST" ? {} : undefined,
      headers: { [deviceIdHeader]: device },
      timeoutMs: 5000,
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        `[bff] ${path} answered outside the contract`,
        parsed.error.issues[0],
      );
      const failure = dailyFailure(503);
      return respond(failure.body, failure.status);
    }
    return respond(parsed.data);
  } catch (error) {
    const failure =
      error instanceof BackendError
        ? dailyFailure(error.status, error.error.fieldErrors)
        : dailyFailure(error instanceof BackendUnavailable ? 503 : 500);
    return respond(failure.body, failure.status);
  }
}
