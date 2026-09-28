import { createHash, randomBytes } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthDatabase } from "./common/database.js";
import { sessions } from "./db/schema.js";
import { type Harness, startHarness, uniqueEmail } from "./test/harness.js";
import { UsersService } from "./users/users.service.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());
beforeEach(() => h.clock.set(new Date()));

const PAY = {
  clientId: "pay-web",
  redirectUri: "https://pay.outegro.dev/auth/callback",
};
const ADMIN = {
  clientId: "admin-web",
  redirectUri: "https://admin.outegro.dev/auth/callback",
};

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorize(
  accessToken: string,
  client = PAY,
  challenge = pkce().challenge,
) {
  return h
    .http()
    .post("/v1/oauth/authorize")
    .set(h.auth(accessToken))
    .send({ ...client, codeChallenge: challenge, codeChallengeMethod: "S256" });
}
const exchange = (body: Record<string, unknown>) =>
  h
    .http()
    .post("/v1/oauth/token")
    .send({ grantType: "authorization_code", ...body });

describe("SSO authorization code (ID-04)", () => {
  it("TC-ID-04-01: an app gets its own session through id.outegro.dev", async () => {
    const idSession = await h.signIn(uniqueEmail("sso"));
    const { verifier, challenge } = pkce();
    const { code } = (
      await authorize(idSession.accessToken, PAY, challenge).expect(201)
    ).body;
    const pay = (
      await exchange({ ...PAY, code, codeVerifier: verifier }).expect(200)
    ).body;
    expect(pay.sessionId).not.toBe(idSession.sessionId);
    const me = await h
      .http()
      .get("/v1/me")
      .set(h.auth(pay.accessToken))
      .expect(200);
    expect(me.body.id).toBe(idSession.user.id);
    const database = h.app.get<AuthDatabase>(DATABASE);
    const [row] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, pay.sessionId));
    expect(row).toMatchObject({ authMethod: "sso", clientId: "pay-web" });
    // The account's session list names the app.
    const list = await h
      .http()
      .get("/v1/me/sessions")
      .set(h.auth(idSession.accessToken))
      .expect(200);
    expect(
      list.body.items.find((s: { id: string }) => s.id === pay.sessionId),
    ).toMatchObject({ authMethod: "sso", clientName: "Payments" });
    // Signing out of the app leaves the central session alone.
    await h
      .http()
      .post("/v1/sessions/logout")
      .send({ refreshToken: pay.refreshToken })
      .expect(204);
    await h.http().get("/v1/me").set(h.auth(idSession.accessToken)).expect(200);
  });

  it("TC-ID-04-02: a code for client A cannot be used by client B or another redirect", async () => {
    const { accessToken } = await h.signIn(uniqueEmail("bind"));
    const { verifier, challenge } = pkce();
    const first = (await authorize(accessToken, PAY, challenge).expect(201))
      .body;
    await exchange({
      ...ADMIN,
      code: first.code,
      codeVerifier: verifier,
    }).expect(422);
    const second = (await authorize(accessToken, PAY, challenge).expect(201))
      .body;
    await exchange({
      ...PAY,
      redirectUri: "https://pay.outegro.dev/other",
      code: second.code,
      codeVerifier: verifier,
    }).expect(422);
  });

  it("TC-ID-04-03: a code works once", async () => {
    const { accessToken } = await h.signIn(uniqueEmail("once"));
    const { verifier, challenge } = pkce();
    const { code } = (await authorize(accessToken, PAY, challenge).expect(201))
      .body;
    await exchange({ ...PAY, code, codeVerifier: verifier }).expect(200);
    const again = await exchange({
      ...PAY,
      code,
      codeVerifier: verifier,
    }).expect(422);
    expect(again.body.error.fieldErrors.code).toEqual(["invalid_grant"]);
  });

  it("TC-ID-04-04: a wrong PKCE verifier burns the code without a session", async () => {
    const { accessToken, user } = await h.signIn(uniqueEmail("pkce"));
    const { verifier, challenge } = pkce();
    const { code } = (await authorize(accessToken, PAY, challenge).expect(201))
      .body;
    await exchange({ ...PAY, code, codeVerifier: pkce().verifier }).expect(422);
    await exchange({ ...PAY, code, codeVerifier: verifier }).expect(422);
    const database = h.app.get<AuthDatabase>(DATABASE);
    const appSessions = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(appSessions.filter((s) => s.clientId)).toHaveLength(0);
  });

  it("TC-ID-04-04: unregistered, lookalike and wildcard redirects are refused", async () => {
    const { accessToken } = await h.signIn(uniqueEmail("redir"));
    for (const redirectUri of [
      "https://pay.outegro.dev/auth/callback/",
      "https://pay.outegro.dev.evil.test/auth/callback",
      "https://pay.outegro.dev/auth/*",
      "https://pay.outegro.dev/auth/callback?next=/x",
    ]) {
      await authorize(accessToken, { ...PAY, redirectUri }).expect(422);
    }
    await authorize(accessToken, {
      clientId: "unknown-app",
      redirectUri: PAY.redirectUri,
    }).expect(422);
    await h
      .http()
      .get(
        `/v1/oauth/clients/pay-web?redirectUri=${encodeURIComponent(PAY.redirectUri)}`,
      )
      .expect(200, { id: "pay-web", name: "Payments" });
  });

  it("requires a signed-in user and rejects expired codes", async () => {
    await h
      .http()
      .post("/v1/oauth/authorize")
      .send({
        ...PAY,
        codeChallenge: pkce().challenge,
        codeChallengeMethod: "S256",
      })
      .expect(401);
    const { accessToken } = await h.signIn(uniqueEmail("exp"));
    const { verifier, challenge } = pkce();
    const { code } = (await authorize(accessToken, PAY, challenge).expect(201))
      .body;
    h.clock.advance(61_000);
    await exchange({ ...PAY, code, codeVerifier: verifier }).expect(422);
  });
});

describe("negative auth checks (ID-10)", () => {
  it("TC-ID-10-04: a suspended user's still-valid token stops working", async () => {
    const { accessToken, refreshToken, user } = await h.signIn(
      uniqueEmail("susp"),
    );
    await h.app
      .get(UsersService)
      .setStatus({ userId: null }, user.id, "suspended", "abuse");
    await h
      .http()
      .patch("/v1/me")
      .set(h.auth(accessToken))
      .send({ expectedVersion: 2, displayName: "x" })
      .expect(401);
    await authorize(accessToken).expect(401);
    await h
      .http()
      .post("/v1/sessions/refresh")
      .send({ refreshToken })
      .expect(401);
  });

  it("TC-ID-10-03: the JWKS rejects tokens of another audience", async () => {
    const { accessToken } = await h.signIn(uniqueEmail("aud"));
    const [, payload] = accessToken.split(".");
    const claims = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString(),
    );
    expect(claims.aud).toBe("outegro");
    const tampered = accessToken.replace(
      payload ?? "",
      Buffer.from(JSON.stringify({ ...claims, aud: "machine" })).toString(
        "base64url",
      ),
    );
    await h.http().get("/v1/me").set(h.auth(tampered)).expect(401);
  });
});
