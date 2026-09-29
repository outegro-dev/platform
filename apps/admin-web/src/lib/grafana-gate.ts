import { createHash } from "node:crypto";
import {
  ACCESS_COOKIE,
  clearSession,
  REFRESH_COOKIE,
  secondsLeft,
} from "@outegro/bff/session";
import { isLocale, LOCALE_COOKIE, type Locale } from "@outegro/i18n/config";
import { type NextRequest, NextResponse } from "next/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import type { Operator } from "./adapters/identity";
import { isIdle, SEEN_COOKIE } from "./idle";
import {
  grafanaHeaders,
  grafanaReturnPath,
  grafanaRole,
  monitoringPath,
} from "./monitoring";
import type { Loaded } from "./result";
import { appUrl, signInPath } from "./session";

/**
 * Grafana behind the console's sign-in. Traefik's ForwardAuth calls
 * `authorizeGrafana` with the browser's cookies before every Grafana
 * request: a 2xx lets the request through with the X-WEBAUTH-* headers of
 * the answer; anything else goes back to the browser as it is. Cookies set
 * on a 2xx never reach the browser, so the gate only reads the session:
 * whenever it needs a refresh, the browser takes a detour through
 * /monitoring, a console route whose proxy pass refreshes and returns.
 */

export type GateDeps = {
  /** The operator, fresh from Identity with this request's session (`getOperator`). */
  operator: () => Promise<Loaded<Operator>>;
  /** ForwardAuth only: the last answer per session, briefly (see below). */
  cache?: OperatorCache;
  now?: () => number;
};

/** The proxy's margin: a token this close to its expiry gets refreshed. */
const FRESH_SECONDS = 30;

export type OperatorCache = {
  get(
    token: string,
    now: number,
    load: () => Promise<Loaded<Operator>>,
  ): Promise<Loaded<Operator>>;
};

/**
 * Grafana fires dozens of requests per screen, each one through
 * ForwardAuth, and Identity allows 120 calls a minute per visitor. So the
 * gate remembers the operator of an access token for `ttlMs` (never past
 * the token's expiry): a revoked session, a suspension or a role change
 * reaches Grafana within that time. Only answers are kept, never failures,
 * and the key is a hash, not the token.
 */
export function createOperatorCache({
  ttlMs = 10_000,
  maxEntries = 500,
} = {}): OperatorCache {
  const entries = new Map<string, { operator: Operator; until: number }>();
  return {
    async get(token, now, load) {
      const key = createHash("sha256").update(token).digest("base64url");
      const hit = entries.get(key);
      if (hit && hit.until > now) return { ok: true, data: hit.operator };
      entries.delete(key);
      const me = await load();
      if (!me.ok) return me;
      if (entries.size >= maxEntries) {
        for (const [stale, entry] of entries)
          if (entry.until <= now) entries.delete(stale);
        const oldest = entries.keys().next();
        if (entries.size >= maxEntries && !oldest.done)
          entries.delete(oldest.value);
      }
      const expires = now + secondsLeft(token, now) * 1000;
      entries.set(key, {
        operator: me.data,
        until: Math.min(now + ttlMs, expires),
      });
      return me;
    },
  };
}

const NO_STORE = "no-store";

/** Absolute, on the public origin: Traefik hands the answer to the browser as it is. */
function redirect(path: string, status: 302 | 303 | 307) {
  const response = NextResponse.redirect(appUrl(path), status);
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}

/** GET and HEAD may turn into GET on the way; other methods keep their body (307). */
const keepsBody = (method: string | null) =>
  !["GET", "HEAD"].includes((method ?? "GET").toUpperCase());

export async function authorizeGrafana(
  request: NextRequest,
  deps: GateDeps,
): Promise<Response> {
  const returnTo = grafanaReturnPath(request.headers.get("x-forwarded-uri"));
  const detour = () =>
    redirect(
      monitoringPath(returnTo),
      keepsBody(request.headers.get("x-forwarded-method")) ? 307 : 302,
    );
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const now = deps.now?.() ?? Date.now();

  if (!access && !request.cookies.get(REFRESH_COOKIE)?.value)
    return redirect(signInPath(returnTo), 302);
  // Missing or expiring, or idle for too long: only a console page can
  // write the new cookies (or end the session), so the browser goes there.
  if (
    !access ||
    secondsLeft(access, now) <= FRESH_SECONDS ||
    isIdle(request.cookies.get(SEEN_COOKIE)?.value, now)
  )
    return detour();

  // X-WEBAUTH-* headers on the request are never read: only this answer names anyone.
  const me = deps.cache
    ? await deps.cache.get(access, now, deps.operator)
    : await deps.operator();
  if (!me.ok) {
    // Revoked, or the account suspended, while its cookie has not expired:
    // /monitoring drops the session and starts a new sign-in.
    if (me.kind === "unauthenticated") return detour();
    return page(request, "unavailable", returnTo);
  }
  const role = grafanaRole(me.data);
  if (!role) return page(request, "forbidden", returnTo, me.data.email);
  const identity = grafanaHeaders(me.data, role);
  if (!identity) {
    console.error("[admin-web] Identity returned an operator without an email");
    return page(request, "unavailable", returnTo);
  }
  const allowed = new NextResponse(null, { status: 200, headers: identity });
  allowed.headers.set("Cache-Control", NO_STORE);
  return allowed;
}

/**
 * `/monitoring?to=/grafana/…`: the proxy has already refreshed the session
 * (or sent a signed-out visitor to sign-in, or ended an idle session), so
 * send the browser back to Grafana, keeping the method of a request with a
 * body. The operator is checked once more, so a session Identity refuses
 * is dropped here instead of bouncing between Grafana and this route.
 */
export async function continueToGrafana(
  request: NextRequest,
  deps: GateDeps,
): Promise<Response> {
  const returnTo = grafanaReturnPath(request.nextUrl.searchParams.get("to"));
  const now = deps.now?.() ?? Date.now();
  // Still expiring after the proxy: Identity did not answer the refresh.
  if (
    secondsLeft(request.cookies.get(ACCESS_COOKIE)?.value, now) <= FRESH_SECONDS
  )
    return page(request, "unavailable", returnTo);
  const me = await deps.operator();
  if (me.ok) return redirect(returnTo, keepsBody(request.method) ? 307 : 303);
  if (me.kind === "unauthenticated") {
    const response = redirect(signInPath(returnTo), 303);
    clearSession(response.cookies);
    response.cookies.delete(SEEN_COOKIE);
    return response;
  }
  return page(request, "unavailable", returnTo);
}

// ── The two pages the gate shows, EN/RU by the shared locale cookie ──────

const PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// Served under /grafana/ where the console's stylesheet is not: system
// colours follow the visitor's light or dark theme.
const PAGE_STYLE = [
  ":root{color-scheme:light dark}",
  'body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:Canvas;color:CanvasText;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  "main{width:100%;max-width:560px}",
  ".eyebrow{margin:0;color:GrayText;font:500 11px/1.4 ui-monospace,SFMono-Regular,monospace;letter-spacing:.08em;text-transform:uppercase}",
  "h1{margin:10px 0 12px;font-size:clamp(26px,5vw,34px);font-weight:600;line-height:1.15;letter-spacing:-.02em}",
  "p{margin:0 0 24px}",
  ".actions{display:flex;flex-wrap:wrap;gap:10px;margin:0}",
  ".actions a{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border:1px solid;border-radius:999px;color:inherit;font-weight:600;text-decoration:none}",
  ".actions a:first-child{border-color:CanvasText;background:CanvasText;color:Canvas}",
  ".actions a:focus-visible{outline:2px solid CanvasText;outline-offset:3px}",
].join("");

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function localeOf(request: NextRequest): Locale {
  const value = request.cookies.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : "en";
}

/** 403 "no access to monitoring" or 503 "could not check your access". */
function page(
  request: NextRequest,
  kind: "forbidden" | "unavailable",
  returnTo: string,
  email = "",
): Response {
  const locale = localeOf(request);
  const t = createTranslator({
    locale,
    messages: locale === "ru" ? ru : en,
    namespace: "monitoring",
  });
  const title =
    kind === "forbidden" ? t("forbiddenTitle") : t("unavailableTitle");
  const body =
    kind === "forbidden" ? t("forbiddenBody", { email }) : t("unavailableBody");
  const links = [
    ...(kind === "unavailable"
      ? [{ href: appUrl(returnTo).toString(), label: t("retry") }]
      : []),
    { href: appUrl("/").toString(), label: t("back") },
  ]
    .map(
      (link) =>
        `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(`${title} · ${t("pageTitle")}`)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<p class="eyebrow">outegro admin · ${escapeHtml(t("pageTitle"))}</p>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p class="actions">${links}</p>
</main>
</body>
</html>
`;
  return new NextResponse(html, {
    status: kind === "forbidden" ? 403 : 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Language": locale,
      "Content-Security-Policy": PAGE_CSP,
      "Cache-Control": NO_STORE,
    },
  });
}
