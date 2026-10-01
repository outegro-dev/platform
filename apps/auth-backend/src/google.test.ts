import { randomUUID } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthDatabase } from "./common/database.js";
import { auditLog, identities, outbox, sessions, users } from "./db/schema.js";
import { type Harness, startHarness, uniqueEmail } from "./test/harness.js";

let h: Harness;
let db: AuthDatabase["db"];

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<AuthDatabase>(DATABASE).db;
});
afterAll(() => h?.close());
beforeEach(async () => {
  h.clock.set(new Date());
  h.google.unavailable = false;
  await h.resetLimits();
});

const account = (email = uniqueEmail("g"), extra = {}) => ({
  subject: randomUUID(),
  email,
  emailVerified: true,
  name: "Test Person",
  ...extra,
});
const payload = (code: string) => ({
  code,
  codeVerifier: "v".repeat(43),
  nonce: "n".repeat(24),
});
const signIn = (code: string, locale = "en") =>
  h
    .http()
    .post("/v1/login/google")
    .send({ ...payload(code), locale });
/** Security notices requested for a user through the outbox (N-06). */
const noticesOf = (userId: string) =>
  db
    .select({
      template: sql<string>`${outbox.envelope}->'payload'->>'templateKey'`,
      data: sql<unknown>`${outbox.envelope}->'payload'->'data'`,
    })
    .from(outbox)
    .where(
      and(
        eq(outbox.type, "notifications.intent.requested.v1"),
        sql`${outbox.envelope}->'payload'->'recipient'->>'userId' = ${userId}`,
      ),
    );

describe("Google sign-in (ID-02)", () => {
  it("tells id-web how to build the authorization request", async () => {
    const res = await h.http().get("/v1/login/google/config").expect(200);
    expect(res.body).toEqual({
      enabled: true,
      clientId: "google-client.test",
      redirectUri: "http://localhost:3002/login/google/callback",
    });
  });

  it("TC-ID-02-01: a new Google account gets one user and one identity", async () => {
    const google = account();
    const first = await signIn(h.google.code(google), "ru").expect(200);
    expect(first.body.user).toMatchObject({
      email: google.email,
      emailVerified: true,
      displayName: "Test Person",
      locale: "ru",
    });
    expect(first.body.accessToken).toBeTruthy();

    const again = await signIn(h.google.code(google)).expect(200);
    expect(again.body.user.id).toBe(first.body.user.id);
    expect(
      await db.select().from(users).where(eq(users.email, google.email)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(identities)
        .where(eq(identities.subject, google.subject)),
    ).toHaveLength(1);
    const methods = await db
      .select({ method: sessions.authMethod })
      .from(sessions)
      .where(eq(sessions.userId, first.body.user.id));
    expect(methods.every((m) => m.method === "google")).toBe(true);
    // Signing up with Google is not a new method on an existing account,
    // and the sign-in that made the account warns nobody; the next one is
    // told, with a browser and a system only from the fixed list.
    expect(await noticesOf(first.body.user.id)).toEqual([
      {
        template: "security.sign-in.v1",
        data: {
          at: h.clock.now().toISOString(),
          method: "google",
          browser: null,
          os: null,
        },
      },
    ]);
  });

  it("TC-ID-02-02: a matching email never joins an existing account on its own", async () => {
    const email = uniqueEmail("owner");
    const owner = await h.signIn(email);
    const google = account(email);

    const refused = await signIn(h.google.code(google)).expect(409);
    expect(refused.body.error.fieldErrors).toEqual({
      email: ["link_required"],
    });
    expect(
      await db
        .select()
        .from(identities)
        .where(eq(identities.userId, owner.user.id)),
    ).toHaveLength(0);

    // The owner links it while signed in; after that Google signs them in.
    const linked = await h
      .http()
      .post("/v1/me/identities/google")
      .set(h.auth(owner.accessToken))
      .send(payload(h.google.code(google)))
      .expect(200);
    expect(linked.body.items).toEqual([
      expect.objectContaining({ provider: "google", email }),
    ]);
    const viaGoogle = await signIn(h.google.code(google))
      .set(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
      )
      .expect(200);
    expect(viaGoogle.body.user.id).toBe(owner.user.id);
    // The owner is told of the link once, with no Google email in the
    // message, and of the Google sign-in; the email-code sign-in before
    // was its own message.
    expect(await noticesOf(owner.user.id)).toEqual([
      {
        template: "security.google-linked.v1",
        data: { at: h.clock.now().toISOString() },
      },
      {
        template: "security.sign-in.v1",
        data: {
          at: h.clock.now().toISOString(),
          method: "google",
          browser: "Safari",
          os: "macOS",
        },
      },
    ]);
  });

  it("will not link a Google account that belongs to someone else", async () => {
    const google = account();
    await signIn(h.google.code(google)).expect(200);
    const other = await h.signIn(uniqueEmail("other"));
    const res = await h
      .http()
      .post("/v1/me/identities/google")
      .set(h.auth(other.accessToken))
      .send(payload(h.google.code(google)))
      .expect(409);
    expect(res.body.error.fieldErrors).toEqual({ identity: ["in_use"] });
  });

  it("refuses unverified emails, bad codes, and says so when Google is down", async () => {
    const results = () =>
      Promise.all(
        ["success", "rejected", "unavailable"].map((result) =>
          h.metric("identity_sign_in_attempts_total", {
            method: "google",
            result,
          }),
        ),
      );
    const before = await results();
    const unverified = account(uniqueEmail("u"), { emailVerified: false });
    const res = await signIn(h.google.code(unverified)).expect(422);
    expect(res.body.error.fieldErrors).toEqual({ email: ["unverified"] });
    expect(
      await db.select().from(users).where(eq(users.email, unverified.email)),
    ).toHaveLength(0);

    const code = h.google.code(account());
    await signIn(code).expect(200);
    const reused = await signIn(code).expect(422);
    expect(reused.body.error.fieldErrors).toEqual({ code: ["invalid_grant"] });

    h.google.unavailable = true;
    await signIn(h.google.code(account())).expect(503);
    // One success, two refusals (unverified email, used code), one outage.
    const [success = 0, rejected = 0, unavailable = 0] = before;
    expect(await results()).toEqual([
      success + 1,
      rejected + 2,
      unavailable + 1,
    ]);
  });

  it("TC-ID-02-03: the last way to sign in cannot be removed", async () => {
    const google = account();
    const session = (await signIn(h.google.code(google)).expect(200)).body;
    await db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, session.user.id));

    const refused = await h
      .http()
      .delete("/v1/me/identities/google")
      .set(h.auth(session.accessToken))
      .expect(409);
    expect(refused.body.error.fieldErrors).toEqual({
      identity: ["last_method"],
    });

    await db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, session.user.id));
    await h
      .http()
      .delete("/v1/me/identities/google")
      .set(h.auth(session.accessToken))
      .expect(204);
    const list = await h
      .http()
      .get("/v1/me/identities")
      .set(h.auth(session.accessToken))
      .expect(200);
    expect(list.body.items).toEqual([]);
    const trail = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetId, session.user.id),
          eq(auditLog.targetType, "user"),
        ),
      );
    expect(trail.map((row) => row.action).sort()).toEqual([
      "identity.linked",
      "identity.unlinked",
    ]);
    // The refused attempt told nobody; the removal is reported once.
    expect(
      (await noticesOf(session.user.id)).map((notice) => notice.template),
    ).toEqual(["security.google-unlinked.v1"]);
  });

  it("does not sign in a suspended user", async () => {
    const google = account();
    const session = (await signIn(h.google.code(google)).expect(200)).body;
    await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, session.user.id));
    await signIn(h.google.code(google)).expect(403);
  });
});
