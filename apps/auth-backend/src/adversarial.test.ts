import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { identityUserStatusChanged } from "@outegro/contracts";
import { DATABASE } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import {
  calculateJwkThumbprint,
  importPKCS8,
  type JWK,
  type JWTHeaderParameters,
  SignJWT,
} from "jose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RolesService } from "./access/roles.service.js";
import type { AuthDatabase } from "./common/database.js";
import {
  auditLog,
  authorizationCodes,
  outbox,
  passkeys,
  roleBindings,
  sessions,
  users,
} from "./db/schema.js";
import { SoftwareAuthenticator } from "./test/authenticator.js";
import {
  type Harness,
  randomIp,
  startHarness,
  uniqueEmail,
} from "./test/harness.js";

/**
 * ID-10: what an attacker (or a mistaken operator) tries after the pieces
 * are integrated. Key rotation, cross-site requests, token confusion and
 * revocation, each checked for the refusal and for the absence of effects.
 * Passkeys (ID-05) at the end: phishing, replay, cloned keys, planting a key.
 */

let h: Harness;
let db: AuthDatabase["db"];
let roles: RolesService;

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<AuthDatabase>(DATABASE).db;
  roles = h.app.get(RolesService);
});
afterAll(() => h?.close());
beforeEach(async () => {
  h.clock.set(new Date());
  await h.resetLimits();
});

type Session = Awaited<ReturnType<Harness["signIn"]>>;

const on = (app: INestApplication) => request(app.getHttpServer());
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const partOf = (token: string, index: 0 | 1) =>
  JSON.parse(
    Buffer.from(token.split(".")[index] ?? "", "base64url").toString(),
  );
const segment = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const newPem = () =>
  generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
const thumbprintOf = (pem: string) =>
  calculateJwkThumbprint(createPublicKey(pem).export({ format: "jwk" }) as JWK);
const identityPem = () => process.env.JWT_PRIVATE_KEY ?? "";
const userRow = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0];

const PAY = {
  clientId: "pay-web",
  redirectUri: "https://pay.outegro.dev/auth/callback",
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  codeChallengeMethod: "S256",
};

/** Owner bootstrap as the CLI does it, then a fresh sign-in carrying the role. */
async function signInAs(role: string) {
  const email = uniqueEmail(role);
  const first = await h.signIn(email);
  await roles.grant(
    { userId: null },
    { userId: first.user.id, role, reason: "test setup" },
  );
  await h.resetLimits();
  return h.signIn(email);
}

describe("TC-ID-10-01: signing key rotation", () => {
  it("the next key signs new tokens; the retired key verifies only while it is published", async () => {
    const nextPem = newPem();
    const [currentKid, nextKid] = await Promise.all([
      thumbprintOf(identityPem()),
      thumbprintOf(nextPem),
    ]);
    const replicas: INestApplication[] = [];
    const replica = async (tokens: Parameters<Harness["boot"]>[0]) => {
      const { app } = await h.boot(tokens);
      replicas.push(app);
      return app;
    };
    const kidsOf = async (app: INestApplication) =>
      (
        (await on(app).get("/.well-known/jwks.json").expect(200)).body as {
          keys: JWK[];
        }
      ).keys;
    try {
      const before = await h.signIn(uniqueEmail("rotate"));
      expect(partOf(before.accessToken, 0).kid).toBe(currentKid);

      // Phase 1: the next key is announced while the current one signs.
      // Exported straight from its PEM, private part included by mistake:
      // only the public half is published, under its own thumbprint.
      const announcing = await replica({
        previousPublicKeys: JSON.stringify([
          createPrivateKey(nextPem).export({ format: "jwk" }),
        ]),
      });
      const announced = await kidsOf(announcing);
      expect(announced.map((key) => key.kid)).toEqual([currentKid, nextKid]);
      for (const key of announced) {
        expect(Object.keys(key).sort()).toEqual([
          "alg",
          "crv",
          "kid",
          "kty",
          "use",
          "x",
          "y",
        ]);
      }

      // Phase 2: the next key signs. The retired key, copied from the live
      // JWKS, stays published; the announced key left in the list is harmless.
      const rotated = await replica({
        privateKeyPem: nextPem,
        previousPublicKeys: JSON.stringify(announced),
      });
      expect((await kidsOf(rotated)).map((key) => key.kid)).toEqual([
        nextKid,
        currentKid,
      ]);
      const after = (
        await on(rotated)
          .post("/v1/sessions/refresh")
          .send({ refreshToken: before.refreshToken })
          .expect(200)
      ).body as Session;
      expect(partOf(after.accessToken, 0).kid).toBe(nextKid);
      await on(rotated)
        .get("/v1/me")
        .set(bearer(after.accessToken))
        .expect(200);
      // The overlap: an unexpired token of the retired key still works.
      await on(rotated)
        .get("/v1/me")
        .set(bearer(before.accessToken))
        .expect(200);
      // Replicas still signing with the current key: one that saw the
      // announcement accepts the new token, one that did not refuses it.
      await on(announcing)
        .get("/v1/me")
        .set(bearer(after.accessToken))
        .expect(200);
      await h.http().get("/v1/me").set(bearer(after.accessToken)).expect(401);

      // A token of the retired key past its expiry is refused in the overlap too.
      h.clock.set(new Date(Date.now() - 10 * 60_000));
      const expired = await h.signIn(uniqueEmail("rotate-expired"));
      h.clock.set(new Date());
      await on(rotated)
        .get("/v1/me")
        .set(bearer(expired.accessToken))
        .expect(401);

      // Phase 3: the overlap is over and the retired key is withdrawn.
      const withdrawn = await replica({
        privateKeyPem: nextPem,
        previousPublicKeys: "[]",
      });
      expect((await kidsOf(withdrawn)).map((key) => key.kid)).toEqual([
        nextKid,
      ]);
      await on(withdrawn)
        .get("/v1/me")
        .set(bearer(before.accessToken))
        .expect(401);
      await on(withdrawn)
        .get("/v1/me")
        .set(bearer(after.accessToken))
        .expect(200);
    } finally {
      await Promise.all(replicas.map((app) => app.close()));
    }
  });
});

describe("TC-ID-10-02: cross-site requests", () => {
  it("a session cookie is no credential here: without the bearer header nothing changes", async () => {
    const session = await h.signIn(uniqueEmail("cookie"));
    const before = await userRow(session.user.id);
    // What a foreign page could make the browser send: its cookies, not a header.
    const cookie = `og_at=${session.accessToken}; og_rt=${session.refreshToken}`;
    await h
      .http()
      .patch("/v1/me")
      .set({ cookie, origin: "https://evil.test" })
      .send({ expectedVersion: before?.version, displayName: "Forged" })
      .expect(401);
    await h
      .http()
      .post("/v1/me/sessions/revoke-all")
      .set({ cookie, origin: "https://evil.test" })
      .send({ includeCurrent: true })
      .expect(401);
    expect(await userRow(session.user.id)).toEqual(before);
    await h.http().get("/v1/me").set(bearer(session.accessToken)).expect(200);
  });

  it("offers no CORS to other origins, so a page cannot add the header itself", async () => {
    const preflight = await h.http().options("/v1/me").set({
      origin: "https://evil.test",
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "authorization,content-type",
    });
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    expect(
      preflight.headers["access-control-allow-credentials"],
    ).toBeUndefined();
  });
});

describe("TC-ID-10-03: token confusion", () => {
  type Bend = {
    header?: Partial<JWTHeaderParameters>;
    claims?: Record<string, unknown>;
    subject?: string;
    issuer?: string;
    audience?: string;
  };

  /** A token under Identity's own key for a live session, bent in one way. */
  async function forge(session: Session, bend: Bend = {}) {
    return new SignJWT({
      sid: session.sessionId,
      roles: [],
      av: 0,
      ...bend.claims,
    })
      .setProtectedHeader({
        alg: "ES256",
        kid: await thumbprintOf(identityPem()),
        typ: "at+jwt",
        ...bend.header,
      })
      .setSubject(bend.subject ?? session.user.id)
      .setIssuer(bend.issuer ?? "http://identity.test")
      .setAudience(bend.audience ?? "outegro")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(await importPKCS8(identityPem(), "ES256"));
  }

  it("accepts only an ES256 access token for this issuer and audience, even under its own key", async () => {
    const session = await h.signIn(uniqueEmail("confusion"));
    const kid = await thumbprintOf(identityPem());
    const [published] = (await h.http().get("/.well-known/jwks.json")).body
      .keys as JWK[];
    const publicPem = createPublicKey(identityPem())
      .export({ type: "spki", format: "pem" })
      .toString();
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: session.user.id,
      sid: session.sessionId,
      roles: ["owner"],
      av: 0,
      iss: "http://identity.test",
      aud: "outegro",
      iat: now,
      exp: now + 300,
    };
    const hmac = (secret: string) =>
      new SignJWT({ sid: session.sessionId, roles: ["owner"], av: 0 })
        .setProtectedHeader({ alg: "HS256", kid, typ: "at+jwt" })
        .setSubject(session.user.id)
        .setIssuer("http://identity.test")
        .setAudience("outegro")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(new TextEncoder().encode(secret));

    // Unbent, the forging is sound: such a token is accepted.
    await h
      .http()
      .get("/v1/me")
      .set(bearer(await forge(session)))
      .expect(200);

    const forgeries: Record<string, string> = {
      "another audience": await forge(session, {
        audience: "payments-internal",
      }),
      "another issuer": await forge(session, {
        issuer: "https://id.evil.test",
      }),
      "a plain JWT type": await forge(session, { header: { typ: "JWT" } }),
      "no token type": await forge(session, { header: { typ: undefined } }),
      "a machine token": await forge(session, {
        subject: "payments-backend",
        claims: { sid: undefined, scope: "users.lookup" },
      }),
      "alg none": `${segment({ alg: "none", kid, typ: "at+jwt" })}.${segment(claims)}.`,
      "HS256 keyed with the public JWK": await hmac(JSON.stringify(published)),
      "HS256 keyed with the public PEM": await hmac(publicPem),
      "another key under Identity's kid": await new SignJWT({
        sid: session.sessionId,
        roles: ["owner"],
        av: 0,
      })
        .setProtectedHeader({ alg: "ES256", kid, typ: "at+jwt" })
        .setSubject(session.user.id)
        .setIssuer("http://identity.test")
        .setAudience("outegro")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(await importPKCS8(newPem(), "ES256")),
    };
    for (const [name, token] of Object.entries(forgeries)) {
      const res = await h.http().get("/v1/me").set(bearer(token));
      expect(res.status, name).toBe(401);
    }

    // A confused token changes nothing either.
    const before = await userRow(session.user.id);
    await h
      .http()
      .patch("/v1/me")
      .set(bearer(forgeries["a plain JWT type"] ?? ""))
      .send({ expectedVersion: before?.version, displayName: "Forged" })
      .expect(401);
    expect(await userRow(session.user.id)).toEqual(before);
  });

  it("the service token opens no user route; user and refresh tokens open no internal one", async () => {
    const owner = await signInAs("owner");
    const target = await h.signIn(uniqueEmail("target"));
    const service = process.env.INTERNAL_API_TOKEN ?? "";

    await h.http().get("/v1/me").set(bearer(service)).expect(401);
    await h
      .http()
      .post(`/v1/admin/users/${target.user.id}/status`)
      .set(bearer(service))
      .send({ status: "suspended", reason: "machine says so" })
      .expect(401);
    await h
      .http()
      .post("/v1/oauth/authorize")
      .set(bearer(service))
      .send(PAY)
      .expect(401);
    for (const token of [
      owner.accessToken,
      owner.refreshToken,
      target.accessToken,
    ]) {
      await h
        .http()
        .post("/v1/internal/users/lookup")
        .set(bearer(token))
        .send({ userId: target.user.id })
        .expect(401);
    }
    // A refresh token is no access token, and the other way round.
    await h.http().get("/v1/me").set(bearer(target.refreshToken)).expect(401);
    const swapped = await h
      .http()
      .post("/v1/sessions/refresh")
      .send({ refreshToken: target.accessToken });
    expect([400, 401]).toContain(swapped.status);

    // None of it touched the target: still active, its session still rotates.
    expect((await userRow(target.user.id))?.status).toBe("active");
    await h
      .http()
      .post("/v1/sessions/refresh")
      .send({ refreshToken: target.refreshToken })
      .expect(200);
  });
});

describe("TC-ID-10-04: revoke", () => {
  it("a suspended user's unexpired token is refused and changes nothing", async () => {
    const owner = await signInAs("owner");
    const user = await h.signIn(uniqueEmail("suspended"));
    await h
      .http()
      .post(`/v1/admin/users/${user.user.id}/status`)
      .set(bearer(owner.accessToken))
      .send({ status: "suspended", reason: "abuse report" })
      .expect(200);
    const suspended = await userRow(user.user.id);
    expect(suspended?.status).toBe("suspended");

    // Minutes before it expires, the token opens nothing.
    await h.http().get("/v1/me").set(bearer(user.accessToken)).expect(401);
    await h
      .http()
      .patch("/v1/me")
      .set(bearer(user.accessToken))
      .send({ expectedVersion: suspended?.version, displayName: "Still here" })
      .expect(401);
    await h
      .http()
      .post("/v1/oauth/authorize")
      .set(bearer(user.accessToken))
      .send(PAY)
      .expect(401);
    await h
      .http()
      .post("/v1/me/sessions/revoke-all")
      .set(bearer(user.accessToken))
      .send({})
      .expect(401);
    await h
      .http()
      .post("/v1/sessions/refresh")
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    expect(await userRow(user.user.id)).toEqual(suspended);
    expect(
      await db
        .select()
        .from(authorizationCodes)
        .where(eq(authorizationCodes.userId, user.user.id)),
    ).toEqual([]);
    const own = await db
      .select({ reason: sessions.revokedReason })
      .from(sessions)
      .where(eq(sessions.userId, user.user.id));
    expect(own).toEqual([{ reason: "admin" }]);
    // Other services learn it with a new access version.
    const [event] = await db
      .select({ envelope: outbox.envelope })
      .from(outbox)
      .where(
        and(
          eq(outbox.type, identityUserStatusChanged.type),
          sql`${outbox.envelope}->'payload'->>'userId' = ${user.user.id}`,
        ),
      );
    expect(event?.envelope).toMatchObject({
      payload: {
        status: "suspended",
        accessVersion: suspended?.accessVersion,
      },
    });
  });

  it("a suspended administrator cannot act, even from a session that survived", async () => {
    const owner = await signInAs("owner");
    const second = await signInAs("owner");
    const support = await signInAs("support");
    const target = await h.signIn(uniqueEmail("target"));

    await h
      .http()
      .post(`/v1/admin/users/${second.user.id}/status`)
      .set(bearer(owner.accessToken))
      .send({ status: "suspended", reason: "compromised laptop" })
      .expect(200);
    await h
      .http()
      .post(`/v1/admin/users/${target.user.id}/role-bindings`)
      .set(bearer(second.accessToken))
      .send({ role: "owner", reason: "escalation" })
      .expect(401);

    // Suspended while its session survived (as after a crash between the
    // status write and the revocation): the fresh permission check refuses.
    await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, support.user.id));
    await h.http().get("/v1/me").set(bearer(support.accessToken)).expect(200);
    await h
      .http()
      .post(`/v1/admin/users/${target.user.id}/sessions/revoke-all`)
      .set(bearer(support.accessToken))
      .send({ reason: "cover tracks" })
      .expect(403);

    expect(
      await db
        .select()
        .from(roleBindings)
        .where(eq(roleBindings.userId, target.user.id)),
    ).toEqual([]);
    await h.http().get("/v1/me").set(bearer(target.accessToken)).expect(200);
  });

  it("sessions revoked by support stop an unexpired token at once", async () => {
    const support = await signInAs("support");
    const user = await h.signIn(uniqueEmail("lost-phone"));
    const before = await userRow(user.user.id);
    await h
      .http()
      .post(`/v1/admin/users/${user.user.id}/sessions/revoke-all`)
      .set(bearer(support.accessToken))
      .send({ reason: "lost phone" })
      .expect(200);
    await h
      .http()
      .patch("/v1/me")
      .set(bearer(user.accessToken))
      .send({ expectedVersion: before?.version, displayName: "Thief" })
      .expect(401);
    expect(await userRow(user.user.id)).toEqual(before);
  });

  it("a revoked role stops working before the token that carries it expires", async () => {
    const owner = await signInAs("owner");
    const support = await signInAs("support");
    const target = await h.signIn(uniqueEmail("target"));
    const [binding] = await db
      .select()
      .from(roleBindings)
      .where(
        and(
          eq(roleBindings.userId, support.user.id),
          eq(roleBindings.state, "active"),
        ),
      );
    await h
      .http()
      .post(`/v1/admin/role-bindings/${binding?.id}/revoke`)
      .set(bearer(owner.accessToken))
      .send({ reason: "left the team" })
      .expect(204);

    // The token still says "support" and its session is alive.
    expect(partOf(support.accessToken, 1).roles).toEqual(["support"]);
    await h.http().get("/v1/me").set(bearer(support.accessToken)).expect(200);
    await h
      .http()
      .post(`/v1/admin/users/${target.user.id}/sessions/revoke-all`)
      .set(bearer(support.accessToken))
      .send({ reason: "stale role" })
      .expect(403);
    const targetSessions = await db
      .select({ revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.userId, target.user.id));
    expect(targetSessions).toEqual([{ revokedAt: null }]);
  });
});

describe("ID-05 passkeys: phishing, replay, cloned keys, planted keys", () => {
  const sessionIds = async (userId: string) =>
    (
      await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, userId))
    )
      .map((row) => row.id)
      .sort();
  const keysOf = (userId: string) =>
    db.select().from(passkeys).where(eq(passkeys.userId, userId));

  /** A victim who registered a passkey on their own device. */
  async function victim(key = new SoftwareAuthenticator()) {
    const session = await h.signIn(uniqueEmail("victim"), "en", randomIp());
    const added = await h.registerPasskey(session.accessToken, key);
    expect(added.status).toBe(201);
    return { session, key };
  }

  it("a look-alike site relaying the victim's ceremony gets no session (TC-ID-10-02)", async () => {
    const { session, key } = await victim();
    const before = await sessionIds(session.user.id);
    // The phishing page asks our options and has the victim's browser
    // answer on its own origin; the authenticator signs for that site.
    for (const ceremony of [
      { origin: "https://id.outegro.dev.evil.test" },
      {
        origin: "https://id.outegro.dev.evil.test",
        rpId: "id.outegro.dev.evil.test",
      },
    ]) {
      const { challengeId, options } = await h.passkeyChallenge();
      const res = await h.passkeyVerify(
        challengeId,
        key.assert(options, ceremony),
      );
      expect(res.status).toBe(422);
      expect(res.body.accessToken).toBeUndefined();
    }
    expect(await sessionIds(session.user.id)).toEqual(before);
  });

  it("an assertion captured on the wire never signs in again", async () => {
    const { session, key } = await victim();
    const { challengeId, options } = await h.passkeyChallenge();
    const captured = key.assert(options);
    await h.passkeyVerify(challengeId, captured).expect(200);
    const before = await sessionIds(session.user.id);
    await h.passkeyVerify(challengeId, captured).expect(422);
    const next = await h.passkeyChallenge();
    await h.passkeyVerify(next.challengeId, captured).expect(422);
    // Forcing the new challenge into the signed data breaks the signature.
    const bent = {
      ...captured,
      response: {
        ...captured.response,
        clientDataJSON: Buffer.from(
          JSON.stringify({
            type: "webauthn.get",
            challenge: next.options.challenge,
            origin: "http://localhost:3002",
            crossOrigin: false,
          }),
        ).toString("base64url"),
      },
    };
    const third = await h.passkeyChallenge();
    await h.passkeyVerify(third.challengeId, bent).expect(422);
    expect(await sessionIds(session.user.id)).toEqual(before);
  });

  it("a cloned security key is refused once the original has moved on", async () => {
    const original = new SoftwareAuthenticator({ counting: true });
    const { session } = await victim(original);
    for (let i = 0; i < 3; i++) {
      const { challengeId, options } = await h.passkeyChallenge();
      await h.passkeyVerify(challengeId, original.assert(options)).expect(200);
    }
    const before = await sessionIds(session.user.id);
    // The copy was taken at counter 1.
    const { challengeId, options } = await h.passkeyChallenge();
    await h
      .passkeyVerify(challengeId, original.assert(options, { counter: 2 }))
      .expect(422);
    expect(await sessionIds(session.user.id)).toEqual(before);
    const [record] = await db
      .select({ data: auditLog.data })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "passkey.counter_regression"),
          eq(auditLog.targetId, session.user.id),
        ),
      );
    expect(record?.data).toMatchObject({
      storedCounter: 3,
      presentedCounter: 2,
    });
  });

  it("a stolen older session, an app session or a cookie cannot plant a passkey", async () => {
    const session = await h.signIn(uniqueEmail("planted"), "en", randomIp());
    const attacker = new SoftwareAuthenticator();
    const cookie = `og_at=${session.accessToken}; og_rt=${session.refreshToken}`;

    // Only cookies, as a foreign page would have the browser send.
    await h
      .http()
      .post("/v1/me/passkeys/options")
      .set({ cookie, origin: "https://evil.test" })
      .expect(401);
    // The service token is no user.
    await h
      .http()
      .post("/v1/me/passkeys/options")
      .set(bearer(process.env.INTERNAL_API_TOKEN ?? ""))
      .expect(401);

    // Token of a session signed in six minutes ago (copied from a laptop).
    h.clock.advance(6 * 60_000);
    const stale = await h
      .http()
      .post("/v1/me/passkeys/options")
      .set({ ...bearer(session.accessToken), "x-forwarded-for": randomIp() })
      .expect(403);
    expect(stale.body.error.fieldErrors).toEqual({
      session: ["reauthentication_required"],
    });
    // And a challenge begun while it was fresh is useless to another session.
    h.clock.set(new Date());
    await h.resetLimits();
    const fresh = await h.signIn(session.user.email, "en", randomIp());
    const begun = await h
      .http()
      .post("/v1/me/passkeys/options")
      .set({ ...bearer(fresh.accessToken), "x-forwarded-for": randomIp() })
      .expect(200);
    await h
      .http()
      .post("/v1/me/passkeys")
      .set({ ...bearer(session.accessToken), "x-forwarded-for": randomIp() })
      .send({
        challengeId: begun.body.challengeId,
        name: "Attacker key",
        response: attacker.register(begun.body.options),
      })
      .expect(422);
    expect(await keysOf(session.user.id)).toEqual([]);
  });

  it("a stolen security key without its PIN, or a suspended owner, signs nobody in (TC-ID-10-04)", async () => {
    const { session, key } = await victim();
    const before = await sessionIds(session.user.id);
    const noPin = await h.passkeyChallenge();
    await h
      .passkeyVerify(
        noPin.challengeId,
        key.assert(noPin.options, { userVerified: false }),
      )
      .expect(422);

    const owner = await signInAs("owner");
    await h
      .http()
      .post(`/v1/admin/users/${session.user.id}/status`)
      .set(bearer(owner.accessToken))
      .send({ status: "suspended", reason: "account takeover report" })
      .expect(200);
    const suspended = await h.passkeyChallenge();
    await h
      .passkeyVerify(suspended.challengeId, key.assert(suspended.options))
      .expect(403);
    // Only the sessions the suspension revoked; nothing new.
    expect(await sessionIds(session.user.id)).toEqual(before);
    expect((await keysOf(session.user.id))[0]?.lastUsedAt).toBeNull();
  });
});
