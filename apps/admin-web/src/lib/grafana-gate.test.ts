import { permissionsOf } from "@outegro/contracts";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Operator } from "./adapters/identity";
import {
  authorizeGrafana,
  continueToGrafana,
  createOperatorCache,
  type GateDeps,
} from "./grafana-gate";
import { SERVER_IDLE_LIMIT_MS } from "./idle";
import type { Loaded } from "./result";
import { appUrl } from "./session";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const seconds = (ms: number) => String(Math.floor(ms / 1000));
/** A JWT-shaped access token expiring `left` seconds after NOW. */
const token = (left: number) =>
  `x.${Buffer.from(JSON.stringify({ exp: Math.floor(NOW / 1000) + left })).toString("base64url")}.y`;

const session = {
  og_at: token(240),
  og_rt: "refresh-token",
  og_admin_seen: seconds(NOW - 60_000),
};

const operator = (roles: string[], over: Partial<Operator> = {}): Operator => ({
  id: "5b449591-1c9c-4b2e-9d6f-0a1b2c3d4e5f",
  email: "Nick@Outegro.dev",
  displayName: "Nick Lukashik",
  locale: "en",
  status: "active",
  roles,
  permissions: [...permissionsOf(roles)],
  ...over,
});

function identity(answer: Loaded<Operator>) {
  const load = vi.fn(async () => answer);
  const deps: GateDeps = { operator: load, now: () => NOW };
  return { deps, load };
}
const signedIn = (roles: string[], over: Partial<Operator> = {}) =>
  identity({ ok: true, data: operator(roles, over) });

/** What Traefik's ForwardAuth sends: GET, the browser's headers, X-Forwarded-*. */
function forwardAuth({
  cookies = session as Record<string, string>,
  uri = "/grafana/d/abc?orgId=1" as string | null,
  method = "GET",
  headers = {} as Record<string, string>,
} = {}) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(
    "http://admin-web.outegro.svc.cluster.local:3004/api/grafana/auth",
    {
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(uri !== null ? { "x-forwarded-uri": uri } : {}),
        "x-forwarded-method": method,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "admin.outegro.dev",
        ...headers,
      },
    },
  );
}

const location = (response: Response) => response.headers.get("location");
const signInTo = (path: string) =>
  appUrl(`/auth/sign-in?returnTo=${encodeURIComponent(path)}`).toString();
const detourTo = (path: string) =>
  appUrl(`/monitoring?to=${encodeURIComponent(path)}`).toString();
const webauth = (response: Response) =>
  [...response.headers.keys()].filter((name) =>
    name.toLowerCase().startsWith("x-webauth-"),
  );

/** ForwardAuth answers never carry cookies: on a 2xx they would be lost. */
function expectNoCookies(response: Response) {
  expect(response.headers.getSetCookie()).toEqual([]);
}

describe("ForwardAuth: no session", () => {
  it("sends the browser to sign-in with the Grafana address to return to", async () => {
    const { deps, load } = signedIn(["owner"]);
    const response = await authorizeGrafana(
      forwardAuth({
        cookies: {},
        uri: "/grafana/d/abc/overview?orgId=1&from=now-6h",
      }),
      deps,
    );
    expect(response.status).toBe(302);
    expect(location(response)).toBe(
      signInTo("/grafana/d/abc/overview?orgId=1&from=now-6h"),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(load).not.toHaveBeenCalled();
    expectNoCookies(response);
  });

  it.each([
    "https://evil.test/grafana/",
    "//evil.test/grafana/",
    "/\\evil.test",
    "/grafana/../auth/sign-out",
    "/grafana/%2e%2e/users",
    "/grafana/..%2f..%2fusers",
    "/users?x=/grafana/",
    null,
  ])("returns to /grafana/ instead of %s", async (uri) => {
    const { deps } = signedIn(["owner"]);
    const response = await authorizeGrafana(
      forwardAuth({ cookies: {}, uri }),
      deps,
    );
    expect(response.status).toBe(302);
    expect(location(response)).toBe(signInTo("/grafana/"));
  });
});

describe("ForwardAuth: a session that needs the console first", () => {
  it("refreshes through /monitoring when the access token is expiring", async () => {
    const { deps, load } = signedIn(["owner"]);
    for (const cookies of [
      { ...session, og_at: token(20) },
      { og_rt: session.og_rt, og_admin_seen: session.og_admin_seen },
    ]) {
      const response = await authorizeGrafana(forwardAuth({ cookies }), deps);
      expect(response.status).toBe(302);
      expect(location(response)).toBe(detourTo("/grafana/d/abc?orgId=1"));
      expectNoCookies(response);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps the method and body of a Grafana API call on the detour", async () => {
    const { deps } = signedIn(["owner"]);
    const response = await authorizeGrafana(
      forwardAuth({
        cookies: { ...session, og_at: token(5) },
        uri: "/grafana/api/ds/query?ds_type=prometheus",
        method: "POST",
      }),
      deps,
    );
    expect(response.status).toBe(307);
    expect(location(response)).toBe(
      detourTo("/grafana/api/ds/query?ds_type=prometheus"),
    );
  });

  it("lets the console end a session idle for too long", async () => {
    const { deps, load } = signedIn(["owner"]);
    const response = await authorizeGrafana(
      forwardAuth({
        cookies: {
          ...session,
          og_admin_seen: seconds(NOW - SERVER_IDLE_LIMIT_MS - 60_000),
        },
      }),
      deps,
    );
    expect(response.status).toBe(302);
    expect(location(response)).toBe(detourTo("/grafana/d/abc?orgId=1"));
    expect(load).not.toHaveBeenCalled();
  });

  it("never lets a revoked session or a suspended account in", async () => {
    // Identity refuses the token although it has not expired yet.
    const { deps } = identity({ ok: false, kind: "unauthenticated" });
    const response = await authorizeGrafana(forwardAuth(), deps);
    expect(response.status).toBe(302);
    expect(location(response)).toBe(detourTo("/grafana/d/abc?orgId=1"));
    expect(webauth(response)).toEqual([]);
  });

  it("keeps Grafana closed when Identity does not answer", async () => {
    const { deps } = identity({
      ok: false,
      kind: "unavailable",
      requestId: null,
    });
    const response = await authorizeGrafana(forwardAuth(), deps);
    expect(response.status).toBe(503);
    expect(webauth(response)).toEqual([]);
    const html = await response.text();
    expect(html).toContain("Could not check your access");
    expect(html).toContain(
      `href="${appUrl("/grafana/d/abc?orgId=1").toString()}"`,
    );
    expectNoCookies(response);
  });
});

describe("ForwardAuth: who gets in, and as whom", () => {
  it("lets an owner in as Admin with all four headers", async () => {
    const { deps } = signedIn(["owner"]);
    const response = await authorizeGrafana(forwardAuth(), deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-webauth-user")).toBe("nick@outegro.dev");
    expect(response.headers.get("x-webauth-email")).toBe("nick@outegro.dev");
    expect(response.headers.get("x-webauth-name")).toBe("Nick Lukashik");
    expect(response.headers.get("x-webauth-role")).toBe("Admin");
    expectNoCookies(response);
  });

  it.each([["auditor"], ["service_operator"]])(
    "lets %s in as Viewer",
    async (role) => {
      const { deps } = signedIn([role], {
        email: "ada.rossi@outegro.dev",
        displayName: "Ada Rossi",
      });
      const response = await authorizeGrafana(forwardAuth(), deps);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-webauth-role")).toBe("Viewer");
      expect(response.headers.get("x-webauth-user")).toBe(
        "ada.rossi@outegro.dev",
      );
      for (const name of [
        "x-webauth-user",
        "x-webauth-email",
        "x-webauth-name",
        "x-webauth-role",
      ])
        expect(response.headers.get(name)).toBeTruthy();
    },
  );

  it.each([
    ["support", ["support"]],
    ["billing", ["billing_operator"]],
    ["a signed-in user without a role", []],
  ])("shows %s the no-access page", async (_, roles) => {
    const { deps } = signedIn(roles, { email: "sam.carter@outegro.dev" });
    const response = await authorizeGrafana(forwardAuth(), deps);
    expect(response.status).toBe(403);
    expect(webauth(response)).toEqual([]);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("No access to monitoring");
    expect(html).toContain("sam.carter@outegro.dev");
    expect(html).toContain(`href="${appUrl("/").toString()}"`);
    expect(html).toContain("Back to the console");
    expectNoCookies(response);
  });

  it("speaks Russian by the shared language cookie", async () => {
    const { deps } = signedIn(["support"]);
    const response = await authorizeGrafana(
      forwardAuth({ cookies: { ...session, og_locale: "ru" } }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-language")).toBe("ru");
    const html = await response.text();
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain("Нет доступа к мониторингу");
    expect(html).toContain("Вернуться в консоль");
  });

  it("keeps a suspended owner out even if Identity still lists the role", async () => {
    const { deps } = signedIn(["owner"], { status: "suspended" });
    const response = await authorizeGrafana(forwardAuth(), deps);
    expect(response.status).toBe(403);
  });

  it("ignores X-WEBAUTH-* headers that arrive with the request", async () => {
    const spoofed = {
      "x-webauth-user": "attacker@evil.test",
      "x-webauth-email": "attacker@evil.test",
      "x-webauth-name": "Attacker",
      "x-webauth-role": "Admin",
    };
    const auditor = signedIn(["auditor"], { email: "ada@outegro.dev" });
    const viewer = await authorizeGrafana(
      forwardAuth({ headers: spoofed }),
      auditor.deps,
    );
    expect(viewer.headers.get("x-webauth-user")).toBe("ada@outegro.dev");
    expect(viewer.headers.get("x-webauth-role")).toBe("Viewer");

    const support = signedIn(["support"]);
    const refused = await authorizeGrafana(
      forwardAuth({ headers: spoofed }),
      support.deps,
    );
    expect(refused.status).toBe(403);
    expect(webauth(refused)).toEqual([]);

    const nobody = await authorizeGrafana(
      forwardAuth({ cookies: {}, headers: spoofed }),
      support.deps,
    );
    expect(nobody.status).toBe(302);
    expect(webauth(nobody)).toEqual([]);
  });

  it("escapes what it prints", async () => {
    const { deps } = signedIn([], { email: '<img src=x onerror="1">@x.test' });
    const html = await (await authorizeGrafana(forwardAuth(), deps)).text();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;@x.test");
  });
});

describe("ForwardAuth: one Identity call per session, briefly", () => {
  // Grafana fires dozens of requests per screen; Identity allows 120 a minute.
  it("answers a burst of Grafana requests with one lookup", async () => {
    const { deps, load } = signedIn(["owner"]);
    const cache = createOperatorCache();
    for (let i = 0; i < 50; i++) {
      const response = await authorizeGrafana(forwardAuth(), {
        ...deps,
        cache,
      });
      expect(response.status).toBe(200);
    }
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks again after ten seconds, so a lost role closes Grafana", async () => {
    let now = NOW;
    let roles = ["owner"];
    const load = vi.fn(
      async (): Promise<Loaded<Operator>> => ({
        ok: true,
        data: operator(roles),
      }),
    );
    const deps: GateDeps = {
      operator: load,
      cache: createOperatorCache({ ttlMs: 10_000 }),
      now: () => now,
    };
    const cookies = { ...session, og_at: token(300) };
    const call = () => authorizeGrafana(forwardAuth({ cookies }), deps);
    expect((await call()).status).toBe(200);
    roles = ["support"];
    now += 9_000;
    expect((await call()).status).toBe(200);
    now += 2_000;
    expect((await call()).status).toBe(403);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never remembers a refusal or an outage", async () => {
    const answers: Loaded<Operator>[] = [
      { ok: false, kind: "unavailable", requestId: null },
      { ok: false, kind: "unauthenticated" },
      { ok: true, data: operator(["auditor"]) },
    ];
    const load = vi.fn(async () => answers.shift() as Loaded<Operator>);
    const deps: GateDeps = {
      operator: load,
      cache: createOperatorCache(),
      now: () => NOW,
    };
    expect((await authorizeGrafana(forwardAuth(), deps)).status).toBe(503);
    expect((await authorizeGrafana(forwardAuth(), deps)).status).toBe(302);
    expect((await authorizeGrafana(forwardAuth(), deps)).status).toBe(200);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("keeps sessions apart and never outlives the token", async () => {
    const owner = operator(["owner"]);
    const auditor = operator(["auditor"], { email: "ada@outegro.dev" });
    const cache = createOperatorCache({ ttlMs: 60_000 });
    const first = await cache.get(token(240), NOW, async () => ({
      ok: true,
      data: owner,
    }));
    const second = await cache.get(token(241), NOW, async () => ({
      ok: true,
      data: auditor,
    }));
    expect(first.ok && first.data.email).toBe(owner.email);
    expect(second.ok && second.data.email).toBe("ada@outegro.dev");
    // A token with 40 s left is remembered for 40 s, not the full minute.
    const load = vi.fn(
      async (): Promise<Loaded<Operator>> => ({
        ok: true,
        data: owner,
      }),
    );
    await cache.get(token(40), NOW, load);
    await cache.get(token(40), NOW + 39_000, load);
    await cache.get(token(40), NOW + 41_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("/monitoring: refresh and return", () => {
  const hop = (
    to: string,
    {
      method = "GET",
      cookies = session as Record<string, string>,
    }: { method?: string; cookies?: Record<string, string> } = {},
  ) =>
    new NextRequest(
      `https://admin.outegro.dev/monitoring?to=${encodeURIComponent(to)}`,
      {
        method,
        headers: {
          cookie: Object.entries(cookies)
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        },
      },
    );

  it("sends the browser back to Grafana once the session is fresh", async () => {
    const { deps } = signedIn(["owner"]);
    const response = await continueToGrafana(
      hop("/grafana/d/abc?orgId=1"),
      deps,
    );
    expect(response.status).toBe(303);
    expect(location(response)).toBe(
      appUrl("/grafana/d/abc?orgId=1").toString(),
    );
    expectNoCookies(response);
  });

  it("keeps the method of a Grafana API call", async () => {
    const { deps } = signedIn(["auditor"]);
    const response = await continueToGrafana(
      hop("/grafana/api/ds/query", { method: "POST" }),
      deps,
    );
    expect(response.status).toBe(307);
    expect(location(response)).toBe(appUrl("/grafana/api/ds/query").toString());
  });

  it.each([
    "https://evil.test/",
    "//evil.test",
    "/auth/sign-out",
    "/grafana/../users",
  ])("never leaves /grafana/ for %s", async (to) => {
    const { deps } = signedIn(["owner"]);
    const response = await continueToGrafana(hop(to), deps);
    expect(location(response)).toBe(appUrl("/grafana/").toString());
  });

  it("drops a session Identity refuses and signs in again", async () => {
    const { deps } = identity({ ok: false, kind: "unauthenticated" });
    const response = await continueToGrafana(hop("/grafana/d/abc"), deps);
    expect(response.status).toBe(303);
    expect(location(response)).toBe(signInTo("/grafana/d/abc"));
    const cleared = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0]);
    expect(cleared.sort()).toEqual(["og_admin_seen=", "og_at=", "og_rt="]);
  });

  it("stops instead of looping when the refresh did not happen", async () => {
    const { deps, load } = signedIn(["owner"]);
    const response = await continueToGrafana(
      hop("/grafana/d/abc", { cookies: { ...session, og_at: token(10) } }),
      deps,
    );
    expect(response.status).toBe(503);
    expect(load).not.toHaveBeenCalled();
    expectNoCookies(response);
  });

  it("stops when Identity does not answer", async () => {
    const { deps } = identity({
      ok: false,
      kind: "unavailable",
      requestId: null,
    });
    const response = await continueToGrafana(hop("/grafana/"), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Try again");
  });
});
