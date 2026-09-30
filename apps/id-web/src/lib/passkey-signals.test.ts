import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signalAcceptedPasskeys, signalUserDetails } from "./passkey-signals";
import type { AcceptedPasskeys, UserDetails } from "./passkeys";

/*
 * The WebAuthn Signal API (PublicKeyCredential.signal*) mocked on the
 * global, underneath @simplewebauthn/browser's sendSignal.
 */

const accepted: AcceptedPasskeys = {
  rpId: "id.outegro.dev",
  userId: "W0SVkRycSy6dbwobLD1OXw",
  credentialIds: ["Y3JlZC1h"],
};
const details: UserDetails = {
  rpId: "id.outegro.dev",
  userId: "W0SVkRycSy6dbwobLD1OXw",
  name: "nick@outegro.dev",
  displayName: "Nick Lukashik",
};

type SignalApi = {
  signalAllAcceptedCredentials?: ReturnType<typeof vi.fn>;
  signalCurrentUserDetails?: ReturnType<typeof vi.fn>;
};

function browserWith(api: SignalApi) {
  vi.stubGlobal("PublicKeyCredential", api);
  return api;
}

/** Lets queued promise callbacks run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.unstubAllGlobals();
});

describe("after a passkey is removed", () => {
  it("tells the device which passkeys the account still accepts", async () => {
    const api = browserWith({
      signalAllAcceptedCredentials: vi.fn(async () => undefined),
    });
    const load = vi.fn(async () => accepted);
    signalAcceptedPasskeys(load);
    await settled();
    expect(load).toHaveBeenCalledOnce();
    expect(api.signalAllAcceptedCredentials).toHaveBeenCalledWith({
      rpId: "id.outegro.dev",
      userId: "W0SVkRycSy6dbwobLD1OXw",
      allAcceptedCredentialIds: ["Y3JlZC1h"],
    });
  });

  it("returns at once: the page never waits for the server or the device", async () => {
    const api = browserWith({
      signalAllAcceptedCredentials: vi.fn(() => new Promise(() => undefined)),
    });
    const load = vi.fn(async () => accepted);
    expect(signalAcceptedPasskeys(load)).toBeUndefined();
    // Nothing has run yet: the caller's state updates come first.
    expect(load).not.toHaveBeenCalled();
    await settled();
    expect(api.signalAllAcceptedCredentials).toHaveBeenCalledOnce();
  });

  it("does not ask the server in a browser without the Signal API", async () => {
    browserWith({});
    const load = vi.fn(async () => accepted);
    signalAcceptedPasskeys(load);
    await settled();
    expect(load).not.toHaveBeenCalled();
    // Nor without WebAuthn at all.
    vi.stubGlobal("PublicKeyCredential", undefined);
    signalAcceptedPasskeys(load);
    await settled();
    expect(load).not.toHaveBeenCalled();
  });

  it("stays quiet when the full list cannot be told", async () => {
    const api = browserWith({ signalAllAcceptedCredentials: vi.fn() });
    signalAcceptedPasskeys(async () => null);
    await settled();
    expect(api.signalAllAcceptedCredentials).not.toHaveBeenCalled();
  });

  it("swallows every failure: the server, the device, a thrown call", async () => {
    const api = browserWith({
      signalAllAcceptedCredentials: vi.fn(async () => {
        throw new DOMException("bad rp", "SecurityError");
      }),
    });
    signalAcceptedPasskeys(async () => accepted);
    signalAcceptedPasskeys(async () => {
      throw new Error("server action failed");
    });
    signalAcceptedPasskeys(() => {
      throw new Error("thrown before a promise");
    });
    await settled();
    expect(api.signalAllAcceptedCredentials).toHaveBeenCalledOnce();
    expect(unhandled).toEqual([]);
  });
});

describe("after the display name changes", () => {
  it("gives the device the account's current name and display name", async () => {
    const api = browserWith({
      signalCurrentUserDetails: vi.fn(async () => undefined),
    });
    expect(signalUserDetails(details)).toBeUndefined();
    await settled();
    expect(api.signalCurrentUserDetails).toHaveBeenCalledWith({
      rpId: "id.outegro.dev",
      userId: "W0SVkRycSy6dbwobLD1OXw",
      name: "nick@outegro.dev",
      displayName: "Nick Lukashik",
    });
  });

  it("does nothing without details or without the Signal API, and never throws", async () => {
    const api = browserWith({
      signalAllAcceptedCredentials: vi.fn(),
    });
    signalUserDetails(details);
    signalUserDetails(undefined);
    await settled();
    expect(api.signalAllAcceptedCredentials).not.toHaveBeenCalled();

    const failing = browserWith({
      signalCurrentUserDetails: vi.fn(async () => {
        throw new DOMException("no", "NotAllowedError");
      }),
    });
    signalUserDetails(details);
    await settled();
    expect(failing.signalCurrentUserDetails).toHaveBeenCalledOnce();
    expect(unhandled).toEqual([]);
  });
});
