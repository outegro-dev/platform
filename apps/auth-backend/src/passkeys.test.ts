import { createHash, randomBytes } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RolesService } from "./access/roles.service.js";
import type { AuthDatabase } from "./common/database.js";
import { relyingParty } from "./config/config.js";
import {
  auditLog,
  identities,
  outbox,
  passkeys,
  sessions,
  users,
} from "./db/schema.js";
import { SoftwareAuthenticator, TEST_RP_ID } from "./test/authenticator.js";
import {
  type Harness,
  randomIp,
  startHarness,
  uniqueEmail,
} from "./test/harness.js";

let h: Harness;
let db: AuthDatabase["db"];

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<AuthDatabase>(DATABASE).db;
});
afterAll(() => h?.close());
beforeEach(async () => {
  h.clock.set(new Date());
  await h.resetLimits();
});

type Session = Awaited<ReturnType<Harness["signIn"]>>;

/** An email-code sign-in from a client address of its own. */
const signIn = (email: string) => h.signIn(email, "en", randomIp());

/** The bearer token, from a client address of its own (route limits are per address). */
const auth = (session: Session | string) => ({
  ...h.auth(typeof session === "string" ? session : session.accessToken),
  "x-forwarded-for": randomIp(),
});
const passkeysOf = (userId: string) =>
  db.select().from(passkeys).where(eq(passkeys.userId, userId));
const sessionsOf = (userId: string) =>
  db
    .select({ id: sessions.id, method: sessions.authMethod })
    .from(sessions)
    .where(eq(sessions.userId, userId));
const actionsOf = async (userId: string) =>
  (
    await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.targetType, "user"), eq(auditLog.targetId, userId)),
      )
  )
    .map((row) => row.action)
    .sort();
/** Security notices requested for a user through the outbox (N-06). */
const noticesOf = (userId: string) =>
  db
    .select({
      template: sql<string>`${outbox.envelope}->'payload'->>'templateKey'`,
      source: sql<string>`${outbox.envelope}->'payload'->>'sourceEventId'`,
      data: sql<unknown>`${outbox.envelope}->'payload'->'data'`,
    })
    .from(outbox)
    .where(
      and(
        eq(outbox.type, "notifications.intent.requested.v1"),
        sql`${outbox.envelope}->'payload'->'recipient'->>'userId' = ${userId}`,
      ),
    );
const signInResults = () =>
  Promise.all(
    ["success", "rejected", "expired"].map((result) =>
      h.metric("identity_sign_in_attempts_total", {
        method: "passkey",
        result,
      }),
    ),
  );

/** A signed-in user with one passkey on the given authenticator. */
async function withPasskey(authenticator = new SoftwareAuthenticator()) {
  const session = await signIn(uniqueEmail("pk"));
  const added = await h.registerPasskey(session.accessToken, authenticator);
  expect(added.status).toBe(201);
  return { session, authenticator, passkey: added.body };
}

/**
 * A full usernameless sign-in with this authenticator's newest passkey;
 * checks the status when one is expected.
 */
async function signInWithPasskey(
  authenticator: SoftwareAuthenticator,
  ceremony: Parameters<SoftwareAuthenticator["assert"]>[1] = {},
  expected?: number,
) {
  const { challengeId, options } = await h.passkeyChallenge();
  const res = await h.passkeyVerify(
    challengeId,
    authenticator.assert(options, ceremony),
  );
  if (expected !== undefined)
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res;
}

describe("relying party configuration (C2.1)", () => {
  it("accepts id.outegro.dev and local development, refuses anything looser", () => {
    expect(relyingParty("id.outegro.dev", "https://id.outegro.dev")).toEqual({
      rpId: "id.outegro.dev",
      origin: "https://id.outegro.dev",
    });
    expect(relyingParty("localhost", "http://localhost:3002/")).toEqual({
      rpId: "localhost",
      origin: "http://localhost:3002",
    });
    for (const [rpId, origin] of [
      ["id.outegro.dev", "https://evil.test"],
      ["id.outegro.dev", "https://id.outegro.dev.evil.test"],
      ["id.outegro.dev", "https://evil-id.outegro.dev"],
      ["id.outegro.dev", "http://id.outegro.dev"],
      ["id.outegro.dev", "https://id.outegro.dev/login"],
      ["pay.outegro.dev", "https://id.outegro.dev"],
      ["localhost", "http://127.0.0.1:3002"],
    ] as const) {
      expect(() => relyingParty(rpId, origin), `${rpId} ${origin}`).toThrow();
    }
  });

  it("options name the configured RP and require a discoverable, verified credential", async () => {
    const session = await signIn(uniqueEmail("options"));
    const creation = await h
      .http()
      .post("/v1/me/passkeys/options")
      .set(auth(session))
      .expect(200);
    expect(creation.body.options).toMatchObject({
      rp: { id: TEST_RP_ID, name: "outegro.dev" },
      user: {
        name: session.user.email,
        // The user handle is the account id, not the email.
        id: Buffer.from(session.user.id.replaceAll("-", ""), "hex").toString(
          "base64url",
        ),
      },
      attestation: "none",
      timeout: 300_000,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const request = await h.passkeyChallenge();
    expect(request.options).toMatchObject({
      rpId: TEST_RP_ID,
      userVerification: "required",
      timeout: 300_000,
    });
    // Usernameless: no credential list tells who may answer.
    expect(request.options.allowCredentials ?? []).toEqual([]);
    // Short-lived: the challenge expires with the ceremony timeout.
    const ttl = await h.valkey.pttl(`wa:auth:${request.challengeId}`);
    expect(ttl).toBeGreaterThan(290_000);
    expect(ttl).toBeLessThanOrEqual(300_000);
  });
});

describe("Passkeys (ID-05)", () => {
  it("TC-ID-05-01: a fresh session adds a passkey; it signs in to the same user through a normal session", async () => {
    const before = await signInResults();
    const authenticator = new SoftwareAuthenticator();
    const { session, passkey } = await withPasskey(authenticator);
    expect(passkey).toMatchObject({
      name: "Test laptop",
      lastUsedAt: null,
      synced: false,
      backedUp: false,
      usable: true,
    });
    const [row] = await passkeysOf(session.user.id);
    expect(row).toMatchObject({
      id: passkey.id,
      userId: session.user.id,
      rpId: TEST_RP_ID,
      signCount: 0,
      transports: ["hybrid", "internal"],
      backupEligible: false,
    });
    expect(row?.aaguid.replaceAll("-", "")).toBe(
      authenticator.aaguid.toString("hex"),
    );
    expect(await actionsOf(session.user.id)).toEqual(["passkey.registered"]);
    expect(await noticesOf(session.user.id)).toEqual([
      {
        template: "security.passkey-added.v1",
        source: passkey.id,
        data: { at: h.clock.now().toISOString() },
      },
    ]);

    const signedIn = await signInWithPasskey(authenticator, {}, 200);
    expect(signedIn.body.user.id).toBe(session.user.id);
    expect(signedIn.body.sessionId).not.toBe(session.sessionId);
    // An ordinary session: its token opens the account and it refreshes.
    const me = await h
      .http()
      .get("/v1/me")
      .set(auth(signedIn.body.accessToken))
      .expect(200);
    expect(me.body.id).toBe(session.user.id);
    await h
      .http()
      .post("/v1/sessions/refresh")
      .set({ "x-forwarded-for": randomIp() })
      .send({ refreshToken: signedIn.body.refreshToken })
      .expect(200);
    expect(
      (await sessionsOf(session.user.id)).find(
        (s) => s.id === signedIn.body.sessionId,
      )?.method,
    ).toBe("passkey");
    const [used] = await passkeysOf(session.user.id);
    expect(used?.lastUsedAt).toEqual(h.clock.now());

    // Every app still signs in through id.outegro.dev with that session.
    const verifier = randomBytes(32).toString("base64url");
    const code = await h
      .http()
      .post("/v1/oauth/authorize")
      .set(auth(signedIn.body.accessToken))
      .send({
        clientId: "pay-web",
        redirectUri: "https://pay.outegro.dev/auth/callback",
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        codeChallengeMethod: "S256",
      })
      .expect(201);
    const app = await h
      .http()
      .post("/v1/oauth/token")
      .set({ "x-forwarded-for": randomIp() })
      .send({
        grantType: "authorization_code",
        clientId: "pay-web",
        redirectUri: "https://pay.outegro.dev/auth/callback",
        code: code.body.code,
        codeVerifier: verifier,
      })
      .expect(200);
    expect(app.body.accessToken).toBeTruthy();

    const [success = 0] = before;
    expect((await signInResults())[0]).toBe(success + 1);
  });

  it("TC-ID-05-01: a registration challenge works once, for its own user and session", async () => {
    const owner = await signIn(uniqueEmail("reg-owner"));
    const other = await signIn(uniqueEmail("reg-other"));
    const authenticator = new SoftwareAuthenticator();
    const begin = async (session: Session) =>
      (
        await h
          .http()
          .post("/v1/me/passkeys/options")
          .set(auth(session))
          .expect(200)
      ).body;
    const finish = (session: Session, challengeId: string, response: unknown) =>
      h
        .http()
        .post("/v1/me/passkeys")
        .set(auth(session))
        .send({ challengeId, name: "Phone", response });

    // Someone else's challenge is no challenge: refused and spent.
    const mine = await begin(owner);
    const planted = authenticator.register(mine.options);
    const stolen = await finish(other, mine.challengeId, planted).expect(422);
    expect(stolen.body.error.fieldErrors).toEqual({ challenge: ["stale"] });
    await finish(owner, mine.challengeId, planted).expect(422);

    // The same user from another session of theirs cannot finish it either.
    await h.resetLimits();
    const second = await signIn(owner.user.email);
    const again = await begin(owner);
    await finish(
      second,
      again.challengeId,
      authenticator.register(again.options),
    ).expect(422);

    // Used once, then gone.
    const fresh = await begin(owner);
    const response = authenticator.register(fresh.options);
    await finish(owner, fresh.challengeId, response).expect(201);
    const replay = await finish(owner, fresh.challengeId, response).expect(422);
    expect(replay.body.error.fieldErrors).toEqual({ challenge: ["stale"] });
    expect(await passkeysOf(owner.user.id)).toHaveLength(1);
    expect(await passkeysOf(other.user.id)).toHaveLength(0);
  });

  it("TC-ID-05-02: an assertion made for another origin or RP is refused and creates no session", async () => {
    const { session, authenticator } = await withPasskey();
    const before = await sessionsOf(session.user.id);
    const [rejectedBefore = 0] = (await signInResults()).slice(1);
    const foreign = [
      { origin: "https://evil.test" },
      // Ours, but not the configured passkey origin.
      { origin: "https://id.outegro.dev" },
      { origin: "http://localhost:3003" },
      { rpId: "evil.test" },
      { rpId: "outegro.dev" },
    ];
    for (const ceremony of foreign) {
      const res = await signInWithPasskey(authenticator, ceremony);
      expect(res.status, JSON.stringify(ceremony)).toBe(422);
      expect(res.body.error.fieldErrors).toEqual({ passkey: ["rejected"] });
      expect(res.body.accessToken).toBeUndefined();
    }
    expect(await sessionsOf(session.user.id)).toEqual(before);
    expect((await passkeysOf(session.user.id))[0]?.lastUsedAt).toBeNull();
    expect((await signInResults())[1]).toBe(rejectedBefore + foreign.length);

    // A registration from another origin or for another RP is refused too.
    for (const ceremony of [
      { origin: "https://evil.test" },
      { rpId: "evil.test" },
    ]) {
      const res = await h.registerPasskey(
        session.accessToken,
        new SoftwareAuthenticator(),
        "Planted",
        ceremony,
      );
      expect(res.status).toBe(422);
    }
    expect(await passkeysOf(session.user.id)).toHaveLength(1);
  });

  it("TC-ID-05-03: the last usable way to sign in cannot be removed", async () => {
    const first = new SoftwareAuthenticator();
    const { session, passkey } = await withPasskey(first);
    const remove = (id: string) =>
      h.http().delete(`/v1/me/passkeys/${id}`).set(auth(session));
    // Without a verified email, the passkey is the only way in.
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, session.user.id));

    const refused = await remove(passkey.id).expect(409);
    expect(refused.body.error.fieldErrors).toEqual({
      passkey: ["last_method"],
    });
    expect(await passkeysOf(session.user.id)).toHaveLength(1);

    // With a second passkey, one of the two may go; then the other is last.
    const second = await h.registerPasskey(
      session.accessToken,
      new SoftwareAuthenticator(),
      "Phone",
    );
    expect(second.status).toBe(201);
    await remove(passkey.id).expect(204);
    await remove(second.body.id).expect(409);

    // A verified email is a way in of its own: then the last passkey may go.
    await db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, session.user.id));
    await remove(second.body.id).expect(204);
    expect(await passkeysOf(session.user.id)).toHaveLength(0);

    // Refusals changed nothing and told nobody; each removal is reported once.
    expect(await actionsOf(session.user.id)).toEqual([
      "passkey.registered",
      "passkey.registered",
      "passkey.removed",
      "passkey.removed",
    ]);
    expect(
      (await noticesOf(session.user.id))
        .filter((n) => n.template === "security.passkey-removed.v1")
        .map((n) => n.source)
        .sort(),
    ).toEqual([passkey.id, second.body.id].sort());
    // A removed passkey signs nobody in.
    const gone = await signInWithPasskey(first, {}, 422);
    expect(gone.body.error.fieldErrors).toEqual({ passkey: ["unknown"] });
  });

  it("TC-ID-05-03: two removals racing for the last two methods leave one", async () => {
    const { session, passkey } = await withPasskey();
    const other = await h.registerPasskey(
      session.accessToken,
      new SoftwareAuthenticator(),
      "Phone",
    );
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, session.user.id));
    const results = await Promise.all(
      [passkey.id, other.body.id].map((id) =>
        h.http().delete(`/v1/me/passkeys/${id}`).set(auth(session)),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(await passkeysOf(session.user.id)).toHaveLength(1);
  });

  it("TC-ID-05-03: Google counts passkeys too, and a passkey counts Google", async () => {
    const { session, passkey } = await withPasskey();
    await db.insert(identities).values({
      userId: session.user.id,
      provider: "google",
      subject: randomBytes(8).toString("hex"),
      email: session.user.email,
      createdAt: h.clock.now(),
    });
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, session.user.id));
    // Google may go while the passkey stays; then the passkey is last.
    await h
      .http()
      .delete("/v1/me/identities/google")
      .set(auth(session))
      .expect(204);
    await h
      .http()
      .delete(`/v1/me/passkeys/${passkey.id}`)
      .set(auth(session))
      .expect(409);
  });

  it("TC-ID-05-04: a used challenge or a replayed assertion is refused without a new session", async () => {
    const { session, authenticator } = await withPasskey();
    const { challengeId, options } = await h.passkeyChallenge();
    const assertion = authenticator.assert(options);
    await h.passkeyVerify(challengeId, assertion).expect(200);
    const after = await sessionsOf(session.user.id);
    const [, , expiredBefore = 0] = await signInResults();

    // The same challenge again: gone.
    const used = await h.passkeyVerify(challengeId, assertion).expect(422);
    expect(used.body.error.fieldErrors).toEqual({ challenge: ["stale"] });
    // The same assertion under a new challenge: it signed the old one.
    const next = await h.passkeyChallenge();
    const replayed = await h
      .passkeyVerify(next.challengeId, assertion)
      .expect(422);
    expect(replayed.body.error.fieldErrors).toEqual({ passkey: ["rejected"] });
    // An unknown challenge id is the same as a used one.
    await h.passkeyVerify(randomUUIDv4(), assertion).expect(422);
    expect(await sessionsOf(session.user.id)).toEqual(after);
    expect((await signInResults())[2]).toBe(expiredBefore + 2);

    // Two verifications racing with one challenge: exactly one session.
    const race = await h.passkeyChallenge();
    const answer = authenticator.assert(race.options);
    const results = await Promise.all([
      h.passkeyVerify(race.challengeId, answer),
      h.passkeyVerify(race.challengeId, answer),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await sessionsOf(session.user.id)).toHaveLength(after.length + 1);
  });

  it("a signature counter that does not grow is refused and kept on record", async () => {
    const key = new SoftwareAuthenticator({ counting: true });
    const { session, passkey } = await withPasskey(key);
    await signInWithPasskey(key, {}, 200); // counter 1
    await signInWithPasskey(key, {}, 200); // counter 2
    const before = await sessionsOf(session.user.id);

    // A copy of the key that is behind (or level with) the original.
    for (const counter of [2, 1, 0]) {
      const res = await signInWithPasskey(key, { counter }, 422);
      expect(res.body.error.fieldErrors).toEqual({ passkey: ["rejected"] });
    }
    expect(await sessionsOf(session.user.id)).toEqual(before);
    const [row] = await passkeysOf(session.user.id);
    expect(row?.signCount).toBe(2);
    const records = await db
      .select({ data: auditLog.data })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "passkey.counter_regression"),
          eq(auditLog.targetId, session.user.id),
        ),
      );
    expect(records).toHaveLength(3);
    expect(records[0]?.data).toMatchObject({
      passkeyId: passkey.id,
      storedCounter: 2,
    });
    // The genuine key, one step ahead, still works.
    await signInWithPasskey(key, { counter: 3 }, 200);

    // A synced passkey never counts (always 0) and keeps working.
    const synced = new SoftwareAuthenticator({ synced: true });
    const other = await withPasskey(synced);
    expect(other.passkey).toMatchObject({ synced: true, backedUp: true });
    await signInWithPasskey(synced, {}, 200);
    await signInWithPasskey(synced, {}, 200);
  });

  it("a passkey signs in only the account it belongs to", async () => {
    const a = await withPasskey();
    const b = await withPasskey();
    const beforeA = await sessionsOf(a.session.user.id);
    const beforeB = await sessionsOf(b.session.user.id);

    // A's credential claiming to be B's account, or no account at all.
    const bHandle = Buffer.from(
      b.session.user.id.replaceAll("-", ""),
      "hex",
    ).toString("base64url");
    for (const userHandle of [bHandle, null]) {
      const res = await signInWithPasskey(a.authenticator, { userHandle });
      expect(res.status).toBe(422);
    }
    expect(await sessionsOf(a.session.user.id)).toEqual(beforeA);
    expect(await sessionsOf(b.session.user.id)).toEqual(beforeB);

    // A's credential id registered again by B: one credential, one account.
    const [aRow] = await passkeysOf(a.session.user.id);
    const claimed = await h.registerPasskey(
      b.session.accessToken,
      new SoftwareAuthenticator(),
      "Borrowed",
      { credentialId: aRow?.credentialId },
    );
    expect(claimed.status).toBe(409);
    expect(claimed.body.error.fieldErrors).toEqual({
      passkey: ["already_registered"],
    });
    expect(await passkeysOf(a.session.user.id)).toEqual([aRow]);

    // B can neither see, rename nor remove A's passkey.
    const listB = await h
      .http()
      .get("/v1/me/passkeys")
      .set(auth(b.session))
      .expect(200);
    expect(listB.body.items.map((i: { id: string }) => i.id)).toEqual([
      b.passkey.id,
    ]);
    await h
      .http()
      .patch(`/v1/me/passkeys/${a.passkey.id}`)
      .set(auth(b.session))
      .send({ name: "Mine now" })
      .expect(404);
    await h
      .http()
      .delete(`/v1/me/passkeys/${a.passkey.id}`)
      .set(auth(b.session))
      .expect(404);
    expect((await passkeysOf(a.session.user.id))[0]?.name).toBe("Test laptop");
  });

  it("user verification is required to add a passkey and to sign in with one", async () => {
    const session = await signIn(uniqueEmail("uv"));
    const key = new SoftwareAuthenticator();
    const unverified = await h.registerPasskey(
      session.accessToken,
      key,
      "No PIN",
      { userVerified: false },
    );
    expect(unverified.status).toBe(422);
    expect(await passkeysOf(session.user.id)).toHaveLength(0);

    await h.registerPasskey(session.accessToken, key).then((r) => {
      expect(r.status).toBe(201);
    });
    const before = await sessionsOf(session.user.id);
    const res = await signInWithPasskey(key, { userVerified: false });
    expect(res.status).toBe(422);
    expect(await sessionsOf(session.user.id)).toEqual(before);
  });

  it("only a recent sign-in on id.outegro.dev may add a passkey", async () => {
    const session = await signIn(uniqueEmail("fresh"));
    const begin = (accessToken: string) =>
      h.http().post("/v1/me/passkeys/options").set(auth(accessToken));
    // Five minutes after signing in it is still fresh, a second later not.
    h.clock.advance(5 * 60_000);
    await begin(session.accessToken).expect(200);
    h.clock.advance(1000);
    const stale = await begin(session.accessToken).expect(403);
    expect(stale.body.error.fieldErrors).toEqual({
      session: ["reauthentication_required"],
    });

    // Signing in again makes a fresh session.
    await h.resetLimits();
    const again = await signIn(session.user.email);
    await begin(again.accessToken).expect(200);

    // An app session (SSO) was not signed in here: it never adds a passkey.
    const verifier = randomBytes(32).toString("base64url");
    const code = await h
      .http()
      .post("/v1/oauth/authorize")
      .set(auth(again.accessToken))
      .send({
        clientId: "pay-web",
        redirectUri: "https://pay.outegro.dev/auth/callback",
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        codeChallengeMethod: "S256",
      })
      .expect(201);
    const app = await h
      .http()
      .post("/v1/oauth/token")
      .set({ "x-forwarded-for": randomIp() })
      .send({
        grantType: "authorization_code",
        clientId: "pay-web",
        redirectUri: "https://pay.outegro.dev/auth/callback",
        code: code.body.code,
        codeVerifier: verifier,
      })
      .expect(200);
    await begin(app.body.accessToken).expect(403);
    expect(await passkeysOf(session.user.id)).toHaveLength(0);
  });

  it("the owner lists and renames their passkeys; names are checked", async () => {
    const { session, passkey } = await withPasskey();
    const later = new Date(h.clock.now().getTime() + 1000);
    h.clock.set(later);
    const phone = await h.registerPasskey(
      session.accessToken,
      new SoftwareAuthenticator(),
      "  Phone  ",
    );
    expect(phone.body.name).toBe("Phone");

    const renamed = await h
      .http()
      .patch(`/v1/me/passkeys/${passkey.id}`)
      .set(auth(session))
      .send({ name: "Work laptop" })
      .expect(200);
    expect(renamed.body).toMatchObject({ id: passkey.id, name: "Work laptop" });
    const list = await h
      .http()
      .get("/v1/me/passkeys")
      .set(auth(session))
      .expect(200);
    expect(
      list.body.items.map((i: { id: string; name: string }) => [i.id, i.name]),
    ).toEqual([
      [passkey.id, "Work laptop"],
      [phone.body.id, "Phone"],
    ]);
    // Nothing secret is listed. The credential id is public by design (the
    // browser holds it); id-web hands it back to the device (Signal API).
    expect(Object.keys(list.body.items[0]).sort()).toEqual([
      "backedUp",
      "createdAt",
      "credentialId",
      "id",
      "lastUsedAt",
      "name",
      "synced",
      "usable",
    ]);
    for (const name of ["", "   ", "x".repeat(61), "line\nbreak", "bidi‮"]) {
      await h
        .http()
        .patch(`/v1/me/passkeys/${passkey.id}`)
        .set(auth(session))
        .send({ name })
        .expect(400);
    }
    for (const id of [randomUUIDv4(), "not-a-uuid"]) {
      await h
        .http()
        .patch(`/v1/me/passkeys/${id}`)
        .set(auth(session))
        .send({ name: "Nope" })
        .expect(404);
    }
    expect(await actionsOf(session.user.id)).toContain("passkey.renamed");
    // Renaming is no security event for the owner's inbox.
    expect(
      (await noticesOf(session.user.id)).map((n) => n.template),
    ).not.toContain("security.passkey-renamed.v1");
  });

  it("a suspended account neither signs in with a passkey nor adds one", async () => {
    const { session, authenticator } = await withPasskey();
    await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, session.user.id));
    const before = await sessionsOf(session.user.id);
    await signInWithPasskey(authenticator, {}, 403);
    expect(await sessionsOf(session.user.id)).toEqual(before);
    expect((await passkeysOf(session.user.id))[0]?.lastUsedAt).toBeNull();
    // Its session is gone with the suspension; a surviving one is refused.
    const res = await h
      .http()
      .post("/v1/me/passkeys/options")
      .set(auth(session));
    expect(res.status).toBe(403);
  });

  it("the begin and finish endpoints are limited per client address", async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push(
        (
          await h
            .http()
            .post("/v1/login/passkey/options")
            .set({ "x-forwarded-for": ip })
        ).status,
      );
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);

    const other = randomIp();
    const guess = {
      id: "AAAA",
      rawId: "AAAA",
      type: "public-key",
      response: {
        clientDataJSON: "e30",
        authenticatorData: "AAAA",
        signature: "AAAA",
      },
      clientExtensionResults: {},
    };
    const verify: number[] = [];
    for (let i = 0; i < 21; i++) {
      verify.push(
        (
          await h
            .http()
            .post("/v1/login/passkey/verify")
            .set({ "x-forwarded-for": other })
            .send({ challengeId: randomUUIDv4(), response: guess })
        ).status,
      );
    }
    // Refused as stale until the limit, then limited.
    expect(verify.slice(0, 20).every((s) => s === 422)).toBe(true);
    expect(verify[20]).toBe(429);

    // Adding passkeys: at most twenty ceremonies an hour per account, from
    // any number of addresses.
    const session = await signIn(uniqueEmail("limit"));
    const begun: number[] = [];
    for (let i = 0; i < 21; i++) {
      begun.push(
        (
          await h
            .http()
            .post("/v1/me/passkeys/options")
            .set({ ...auth(session), "x-forwarded-for": randomIp() })
        ).status,
      );
    }
    expect(begun.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(begun[20]).toBe(429);
  });

  it("a passkey of another relying party (the old domain) is listed as unusable, signs nobody in and counts as no way in", async () => {
    const legacy = new SoftwareAuthenticator();
    const { session, passkey } = await withPasskey(legacy);
    // A second later, so the list order (oldest first) is fixed.
    h.clock.advance(1000);
    const current = await h.registerPasskey(
      session.accessToken,
      new SoftwareAuthenticator(),
      "Phone",
    );
    // As if it had been created for outegro.com and carried over.
    await db
      .update(passkeys)
      .set({ rpId: "outegro.com" })
      .where(eq(passkeys.id, passkey.id));
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, session.user.id));

    const list = await h
      .http()
      .get("/v1/me/passkeys")
      .set(auth(session))
      .expect(200);
    expect(
      list.body.items.map((i: { id: string; usable: boolean }) => [
        i.id,
        i.usable,
      ]),
    ).toEqual([
      [passkey.id, false],
      [current.body.id, true],
    ]);
    const refused = await signInWithPasskey(
      legacy,
      { rpId: "outegro.com" },
      422,
    );
    expect(refused.body.error.fieldErrors).toEqual({ passkey: ["unknown"] });
    // The only usable method is the current passkey; the old one may go.
    await h
      .http()
      .delete(`/v1/me/passkeys/${current.body.id}`)
      .set(auth(session))
      .expect(409);
    await h
      .http()
      .delete(`/v1/me/passkeys/${passkey.id}`)
      .set(auth(session))
      .expect(204);
  });
});

describe("a passkey sign-in is told to the account owner", () => {
  it("names the method, the time and a browser and a system from the list; nothing else", async () => {
    const { session, authenticator } = await withPasskey();
    const { challengeId, options } = await h.passkeyChallenge();
    await h
      .passkeyVerify(challengeId, authenticator.assert(options, {}))
      .set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 <img src=x>",
      )
      .expect(200);
    const signIns = (await noticesOf(session.user.id)).filter(
      (n) => n.template === "security.sign-in.v1",
    );
    const [sessionRow] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, session.user.id),
          eq(sessions.authMethod, "passkey"),
        ),
      );
    expect(signIns).toEqual([
      {
        template: "security.sign-in.v1",
        source: sessionRow?.id,
        data: {
          at: h.clock.now().toISOString(),
          method: "passkey",
          browser: "Chrome",
          os: "Windows",
        },
      },
    ]);
    // A refused sign-in tells nothing.
    await signInWithPasskey(
      authenticator,
      { origin: "https://evil.test" },
      422,
    );
    expect(
      (await noticesOf(session.user.id)).filter(
        (n) => n.template === "security.sign-in.v1",
      ),
    ).toHaveLength(1);
  });
});

describe("an operator removes a user's lost passkey", () => {
  /**
   * A signed-in user given a platform role, as the CLI grants it. Admin
   * commands read permissions from the database, so the same session acts.
   */
  async function operator(role: string) {
    const session = await signIn(uniqueEmail(role));
    await h.app
      .get(RolesService)
      .grant(
        { userId: null },
        {
          userId: session.user.id,
          role,
          reason: "test setup",
          expiresAt: null,
        },
      );
    return session;
  }
  const listFor = (by: Session, userId: string) =>
    h.http().get(`/v1/admin/users/${userId}/passkeys`).set(auth(by));
  const revoke = (
    by: Session,
    userId: string,
    passkeyId: string,
    body: object = { reason: "Lost phone, owner confirmed in ticket 4521" },
  ) =>
    h
      .http()
      .post(`/v1/admin/users/${userId}/passkeys/${passkeyId}/revoke`)
      .set(auth(by))
      .send(body);
  const revokedNotices = async (userId: string) =>
    (await noticesOf(userId)).filter(
      (n) => n.template === "security.passkey-revoked.v1",
    );

  it("support sees the user's passkeys: name, when added and last used, synced", async () => {
    const synced = new SoftwareAuthenticator({ synced: true });
    const { session, passkey } = await withPasskey(synced);
    await signInWithPasskey(synced, {}, 200);
    const support = await operator("support");
    const res = await listFor(support, session.user.id).expect(200);
    expect(res.body.items).toEqual([
      {
        id: passkey.id,
        name: "Test laptop",
        createdAt: passkey.createdAt,
        lastUsedAt: h.clock.now().toISOString(),
        synced: true,
        backedUp: true,
        usable: true,
      },
    ]);
    // Reading needs users.read; a billing operator has none.
    const billing = await operator("billing_operator");
    await listFor(billing, session.user.id).expect(403);
    await listFor(session, session.user.id).expect(403);
    for (const id of [randomUUIDv4(), "not-a-uuid"])
      await listFor(support, id).expect(404);
  });

  it("support removes it with a reason: audited, the user told, the passkey signs nobody in", async () => {
    const { session, authenticator, passkey } = await withPasskey();
    const support = await operator("support");
    await revoke(support, session.user.id, passkey.id).expect(204);
    expect(await passkeysOf(session.user.id)).toHaveLength(0);

    const entries = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetId, session.user.id),
          eq(auditLog.action, "passkey.revoked"),
        ),
      );
    expect(entries).toMatchObject([
      {
        actorId: support.user.id,
        targetType: "user",
        reason: "Lost phone, owner confirmed in ticket 4521",
        data: { passkeyId: passkey.id },
      },
    ]);
    // One notice of its own, with the time only: no name, no reason.
    expect(await revokedNotices(session.user.id)).toEqual([
      {
        template: "security.passkey-revoked.v1",
        source: passkey.id,
        data: { at: h.clock.now().toISOString() },
      },
    ]);
    expect(
      (await noticesOf(session.user.id)).map((n) => n.template).sort(),
    ).toEqual(["security.passkey-added.v1", "security.passkey-revoked.v1"]);
    const gone = await signInWithPasskey(authenticator, {}, 422);
    expect(gone.body.error.fieldErrors).toEqual({ passkey: ["unknown"] });
    // Removing it again finds nothing.
    await revoke(support, session.user.id, passkey.id).expect(404);
  });

  it("needs passkeys.revoke, a reason and the user's own passkey; otherwise nothing changes", async () => {
    const { session, passkey } = await withPasskey();
    const other = await withPasskey();
    const billing = await operator("billing_operator");
    await revoke(billing, session.user.id, passkey.id).expect(403);
    await revoke(session, session.user.id, passkey.id).expect(403);
    const support = await operator("support");
    for (const body of [{}, { reason: "no" }, { reason: "          " }])
      await revoke(support, session.user.id, passkey.id, body).expect(400);
    // Someone else's passkey, an unknown id or a malformed one: not found.
    for (const id of [other.passkey.id, randomUUIDv4(), "not-a-uuid"])
      await revoke(support, session.user.id, id).expect(404);
    await revoke(support, randomUUIDv4(), passkey.id).expect(404);

    expect(await passkeysOf(session.user.id)).toHaveLength(1);
    expect(await passkeysOf(other.session.user.id)).toHaveLength(1);
    expect(await actionsOf(session.user.id)).toEqual(["passkey.registered"]);
    expect(await revokedNotices(session.user.id)).toEqual([]);
  });

  it("the operator cannot take the last way in either; a verified email is one", async () => {
    const { session, passkey } = await withPasskey();
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, session.user.id));
    const support = await operator("support");
    const refused = await revoke(support, session.user.id, passkey.id).expect(
      409,
    );
    expect(refused.body.error.fieldErrors).toEqual({
      passkey: ["last_method"],
    });
    expect(await passkeysOf(session.user.id)).toHaveLength(1);
    expect(await actionsOf(session.user.id)).toEqual(["passkey.registered"]);
    expect(await revokedNotices(session.user.id)).toEqual([]);

    await db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, session.user.id));
    await revoke(support, session.user.id, passkey.id).expect(204);
    expect(await passkeysOf(session.user.id)).toHaveLength(0);
  });
});

function randomUUIDv4() {
  return globalThis.crypto.randomUUID();
}
