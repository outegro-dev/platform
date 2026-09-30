import { describe, expect, it } from "vitest";
import {
  acceptedPasskeysSignal,
  type PasskeyItem,
  passkeyRpId,
  userDetailsSignal,
  userHandle,
} from "./passkeys";

const USER = "5b449591-1c9c-4b2e-9d6f-0a1b2c3d4e5f";
/** The 16 bytes of the UUID, as auth-backend hands them to the authenticator. */
const HANDLE = Buffer.from(USER.replaceAll("-", ""), "hex").toString(
  "base64url",
);

const passkey = (over: Partial<PasskeyItem> = {}): PasskeyItem => ({
  id: "0f8c4c6e-8f7a-4f4e-9d8b-1c2d3e4f5a6b",
  name: "MacBook",
  createdAt: "2026-09-30T10:00:00.000Z",
  lastUsedAt: null,
  synced: true,
  backedUp: true,
  usable: true,
  ...over,
});

describe("passkey signals, as the server prepares them", () => {
  it("names the account by its user handle and the RP by this app's host", () => {
    expect(userHandle(USER)).toBe(HANDLE);
    expect(Buffer.from(userHandle(USER), "base64url")).toHaveLength(16);
    // ID_URL is unset in tests: production's id.outegro.dev.
    expect(passkeyRpId()).toBe("id.outegro.dev");
  });

  it("lists every passkey the account still accepts", () => {
    expect(
      acceptedPasskeysSignal(USER, [
        passkey({ credentialId: "Y3JlZC1h" }),
        passkey({ credentialId: "Y3JlZC1i" }),
      ]),
    ).toEqual({
      rpId: "id.outegro.dev",
      userId: HANDLE,
      credentialIds: ["Y3JlZC1h", "Y3JlZC1i"],
    });
  });

  it("says that none is left after the last one went", () => {
    expect(acceptedPasskeysSignal(USER, [])).toEqual({
      rpId: "id.outegro.dev",
      userId: HANDLE,
      credentialIds: [],
    });
  });

  it("leaves out passkeys of another relying party: they are not this RP's to list", () => {
    expect(
      acceptedPasskeysSignal(USER, [
        passkey({ credentialId: "Y3JlZC1h" }),
        passkey({ usable: false }),
      ])?.credentialIds,
    ).toEqual(["Y3JlZC1h"]);
  });

  it("sends nothing unless every accepted passkey is known by its credential id", () => {
    // A partial list would have the device hide passkeys that still work.
    expect(
      acceptedPasskeysSignal(USER, [
        passkey({ credentialId: "Y3JlZC1h" }),
        passkey(),
      ]),
    ).toBeNull();
    expect(
      acceptedPasskeysSignal(USER, [passkey({ credentialId: "" })]),
    ).toBeNull();
  });

  it("gives the name and display name the passkeys were created with", () => {
    expect(
      userDetailsSignal({
        id: USER,
        email: "nick@outegro.dev",
        displayName: "Nick Lukashik",
      }),
    ).toEqual({
      rpId: "id.outegro.dev",
      userId: HANDLE,
      name: "nick@outegro.dev",
      displayName: "Nick Lukashik",
    });
    // Without a display name the email stands in, as at registration.
    expect(
      userDetailsSignal({
        id: USER,
        email: "nick@outegro.dev",
        displayName: null,
      }).displayName,
    ).toBe("nick@outegro.dev");
  });
});
