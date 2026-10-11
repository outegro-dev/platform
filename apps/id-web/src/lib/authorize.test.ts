import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { productionPlatformUrls } from "@outegro/ui/lib/platform";
import { describe, expect, it } from "vitest";
import {
  isPlatformCallback,
  parseAuthorizeRequest,
  registryFailure,
  silentAnswer,
  silentError,
} from "./authorize";

const refusal = (status: number) =>
  new BackendError(status, {
    code: "X",
    messageKey: "errors.x",
    fieldErrors: {},
    requestId: "r",
    retryable: false,
  });

/** What an app sends to /authorize, as `@outegro/bff/sso` builds it. */
const query = {
  response_type: "code",
  client_id: "landing-web",
  redirect_uri: "https://outegro.dev/auth/callback",
  state: "s".repeat(32),
  code_challenge: "c".repeat(43),
  code_challenge_method: "S256",
};

describe("parseAuthorizeRequest", () => {
  it("reads an app's request, silent only with prompt=none", () => {
    expect(parseAuthorizeRequest(query)).toMatchObject({
      client_id: "landing-web",
      redirect_uri: "https://outegro.dev/auth/callback",
      silent: false,
    });
    expect(parseAuthorizeRequest({ ...query, prompt: "none" })?.silent).toBe(
      true,
    );
  });

  it.each(["login", "consent", "select_account", ""])(
    "ignores prompt=%s instead of calling the link broken",
    (prompt) => {
      expect(parseAuthorizeRequest({ ...query, prompt })?.silent).toBe(false);
    },
  );

  it.each([
    ["no state", { state: undefined }],
    ["a short state", { state: "s" }],
    ["a plain challenge", { code_challenge_method: "plain" }],
    ["a relative redirect", { redirect_uri: "/auth/callback" }],
    ["a repeated parameter", { client_id: ["landing-web", "pay-web"] }],
  ])("calls a request with %s broken", (_, change) => {
    expect(parseAuthorizeRequest({ ...query, ...change })).toBeNull();
  });
});

describe("registryFailure", () => {
  const silent = { silent: true, redirect_uri: query.redirect_uri };

  it.each([
    ["an unknown client", refusal(404)],
    ["an unregistered redirect URI", refusal(422)],
  ])("never redirects for %s, even a silent request", (_, error) => {
    expect(registryFailure(error, silent, productionPlatformUrls)).toBe(
      "invalid",
    );
    expect(
      registryFailure(
        error,
        { ...silent, silent: false },
        productionPlatformUrls,
      ),
    ).toBe("invalid");
  });

  it("answers a silent request in an outage only at a platform callback", () => {
    const outage = new BackendUnavailable("timeout");
    expect(registryFailure(outage, silent, productionPlatformUrls)).toBe(
      "answer",
    );
    expect(
      registryFailure(
        outage,
        { silent: true, redirect_uri: "https://evil.test/auth/callback" },
        productionPlatformUrls,
      ),
    ).toBe("outage");
    expect(
      registryFailure(
        outage,
        { ...silent, silent: false },
        productionPlatformUrls,
      ),
    ).toBe("outage");
  });
});

describe("silentAnswer", () => {
  it("answers the app's callback with the error and its state, nothing else", () => {
    const answer = new URL(
      silentAnswer(
        "https://battleship.outegro.dev/auth/callback",
        "s".repeat(32),
        "login_required",
      ),
    );
    expect(`${answer.origin}${answer.pathname}`).toBe(
      "https://battleship.outegro.dev/auth/callback",
    );
    expect(Object.fromEntries(answer.searchParams)).toEqual({
      error: "login_required",
      state: "s".repeat(32),
    });
  });
});

describe("silentError", () => {
  it.each([
    [refusal(401), "login_required"],
    [refusal(403), "invalid_request"],
    [refusal(422), "invalid_request"],
    [refusal(500), "temporarily_unavailable"],
    [new BackendUnavailable("timeout"), "temporarily_unavailable"],
  ])("reads %s as %s", (error, answer) => {
    expect(silentError(error)).toBe(answer);
  });
});

describe("isPlatformCallback", () => {
  it.each([
    "https://battleship.outegro.dev/auth/callback",
    "https://edu.outegro.dev/auth/callback",
    "https://pay.outegro.dev/auth/callback",
    "https://admin.outegro.dev/auth/callback",
    // The portfolio site signs in silently too.
    "https://outegro.dev/auth/callback",
  ])("knows %s", (uri) => {
    expect(isPlatformCallback(uri, productionPlatformUrls)).toBe(true);
  });

  it.each([
    "https://evil.test/auth/callback",
    "https://battleship.outegro.dev.evil.test/auth/callback",
    "https://battleship.outegro.dev/auth/callback?next=https://evil.test",
    "https://battleship.outegro.dev/auth/callback/",
    "https://battleship.outegro.dev/",
    "http://battleship.outegro.dev/auth/callback",
    "https://outegro.dev/auth/callback?next=https://evil.test",
    "https://www.outegro.dev/auth/callback",
    // Identity is not an SSO client of itself.
    "https://id.outegro.dev/auth/callback",
  ])("refuses %s", (uri) => {
    expect(isPlatformCallback(uri, productionPlatformUrls)).toBe(false);
  });
});
