import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginSignIn, completeSignIn, decodePending } from "./sso";

const client = {
  idUrl: "https://id.outegro.test",
  authApiUrl: "http://auth.internal",
  clientId: "battleship-web",
  redirectUri: "https://battleship.outegro.test/auth/callback",
};

const tokens = {
  sessionId: "s1",
  accessToken: "a",
  accessTokenExpiresAt: "2026-09-29T00:05:00.000Z",
  refreshToken: "r",
  refreshTokenExpiresAt: "2026-10-29T00:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("beginSignIn", () => {
  it("builds an S256 authorization request and remembers the verifier", () => {
    const { url, cookie } = beginSignIn(client, "/play?mode=quick");
    const request = new URL(url);
    const pending = decodePending(cookie);
    expect(request.origin + request.pathname).toBe(
      "https://id.outegro.test/authorize",
    );
    expect(request.searchParams.get("client_id")).toBe("battleship-web");
    expect(request.searchParams.get("redirect_uri")).toBe(client.redirectUri);
    expect(request.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.searchParams.get("state")).toBe(pending?.state);
    expect(request.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(pending?.verifier ?? "")
        .digest("base64url"),
    );
    expect(pending?.returnTo).toBe("/play?mode=quick");
  });

  it("never returns to another origin", () => {
    const { cookie } = beginSignIn(client, "https://evil.test/");
    expect(decodePending(cookie)?.returnTo).toBe("/");
  });

  it("asks without a sign-in page only when silent", () => {
    const interactive = beginSignIn(client, "/");
    expect(new URL(interactive.url).searchParams.has("prompt")).toBe(false);
    expect(decodePending(interactive.cookie)?.silent).toBe(false);

    const silent = beginSignIn(client, "/", { silent: true });
    expect(new URL(silent.url).searchParams.get("prompt")).toBe("none");
    expect(decodePending(silent.cookie)?.silent).toBe(true);
  });

  it("reads a pending sign-in written before silent mode as interactive", () => {
    const legacy = Buffer.from(
      JSON.stringify({ state: "s".repeat(32), verifier: "v", returnTo: "/" }),
    ).toString("base64url");
    expect(decodePending(legacy)?.silent).toBe(false);
  });
});

describe("completeSignIn", () => {
  it("exchanges the code with the stored verifier", async () => {
    const { url, cookie } = beginSignIn(client, "/shop");
    const state = new URL(url).searchParams.get("state") ?? "";
    const fetchMock = vi.fn(async () => Response.json(tokens));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeSignIn(
      client,
      new URLSearchParams({ code: "c".repeat(43), state }),
      cookie,
    );

    expect(result).toEqual({
      ok: true,
      tokens,
      returnTo: "/shop",
      silent: false,
    });
    const [target, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(target).toBe("http://auth.internal/v1/oauth/token");
    expect(JSON.parse(init.body as string)).toMatchObject({
      grantType: "authorization_code",
      clientId: "battleship-web",
      codeVerifier: decodePending(cookie)?.verifier,
    });
  });

  it("rejects a callback whose state does not match, without calling Identity", async () => {
    const { cookie } = beginSignIn(client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await completeSignIn(
      client,
      new URLSearchParams({
        code: "c".repeat(43),
        state: "forged-state-value",
      }),
      cookie,
    );
    expect(result).toEqual({
      ok: false,
      reason: "state_mismatch",
      silent: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a callback without a pending sign-in", async () => {
    const result = await completeSignIn(
      client,
      new URLSearchParams({ code: "c".repeat(43), state: "x".repeat(32) }),
      undefined,
    );
    expect(result).toEqual({
      ok: false,
      reason: "state_mismatch",
      silent: false,
    });
  });

  it("maps a refused code and an outage to distinct failures", async () => {
    const { url, cookie } = beginSignIn(client);
    const params = new URLSearchParams({
      code: "c".repeat(43),
      state: new URL(url).searchParams.get("state") ?? "",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "UNPROCESSABLE",
              messageKey: "errors.unprocessable",
              fieldErrors: { code: ["invalid_grant"] },
              requestId: "r",
              retryable: false,
            },
          },
          { status: 422 },
        ),
      ),
    );
    expect(await completeSignIn(client, params, cookie)).toEqual({
      ok: false,
      reason: "invalid_grant",
      silent: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await completeSignIn(client, params, cookie)).toEqual({
      ok: false,
      reason: "unavailable",
      silent: false,
    });
  });

  it("returns a failed silent attempt to its page instead of an error", async () => {
    const { url, cookie } = beginSignIn(client, "/leaderboard", {
      silent: true,
    });
    const state = new URL(url).searchParams.get("state") ?? "";
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "UNPROCESSABLE",
            messageKey: "errors.unprocessable",
            fieldErrors: { code: ["invalid_grant"] },
            requestId: "r",
            retryable: false,
          },
        },
        { status: 422 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // No session at Identity: an answer without a code, nothing to exchange.
    expect(
      await completeSignIn(
        client,
        new URLSearchParams({ error: "login_required", state }),
        cookie,
      ),
    ).toEqual({
      ok: false,
      reason: "login_required",
      silent: true,
      returnTo: "/leaderboard",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(
      await completeSignIn(
        client,
        new URLSearchParams({ code: "c".repeat(43), state }),
        cookie,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid_grant",
      silent: true,
      returnTo: "/leaderboard",
    });
  });

  it("says which session came from a silent attempt", async () => {
    const { url, cookie } = beginSignIn(client, "/leaderboard", {
      silent: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(tokens)),
    );
    expect(
      await completeSignIn(
        client,
        new URLSearchParams({
          code: "c".repeat(43),
          state: new URL(url).searchParams.get("state") ?? "",
        }),
        cookie,
      ),
    ).toEqual({ ok: true, tokens, returnTo: "/leaderboard", silent: true });
  });

  it("reads Identity's outage answer as an outage, not a refusal", async () => {
    const { url, cookie } = beginSignIn(client, "/", { silent: true });
    expect(
      await completeSignIn(
        client,
        new URLSearchParams({
          error: "temporarily_unavailable",
          state: new URL(url).searchParams.get("state") ?? "",
        }),
        cookie,
      ),
    ).toEqual({
      ok: false,
      reason: "unavailable",
      silent: true,
      returnTo: "/",
    });
  });

  it("trusts a silent answer only with the state it was asked with", async () => {
    const { cookie } = beginSignIn(client, "/leaderboard", { silent: true });
    expect(
      await completeSignIn(
        client,
        new URLSearchParams({
          error: "login_required",
          state: "forged-state-value",
        }),
        cookie,
      ),
    ).toEqual({ ok: false, reason: "state_mismatch", silent: false });
  });

  it("reads an error without a code as a missing code when sign-in was asked for", async () => {
    const { url, cookie } = beginSignIn(client, "/shop");
    const state = new URL(url).searchParams.get("state") ?? "";
    expect(
      await completeSignIn(
        client,
        new URLSearchParams({ error: "access_denied", state }),
        cookie,
      ),
    ).toEqual({ ok: false, reason: "missing_code", silent: false });
  });

  it("ignores a tampered cookie", () => {
    expect(decodePending("not-base64-json")).toBeNull();
    expect(
      decodePending(Buffer.from('{"state":1}').toString("base64url")),
    ).toBeNull();
  });
});
