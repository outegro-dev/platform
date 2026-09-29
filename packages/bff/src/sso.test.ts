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

    expect(result).toEqual({ ok: true, tokens, returnTo: "/shop" });
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
    expect(result).toEqual({ ok: false, reason: "state_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a callback without a pending sign-in", async () => {
    const result = await completeSignIn(
      client,
      new URLSearchParams({ code: "c".repeat(43), state: "x".repeat(32) }),
      undefined,
    );
    expect(result).toEqual({ ok: false, reason: "state_mismatch" });
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
    });
  });

  it("ignores a tampered cookie", () => {
    expect(decodePending("not-base64-json")).toBeNull();
    expect(
      decodePending(Buffer.from('{"state":1}').toString("base64url")),
    ).toBeNull();
  });
});
