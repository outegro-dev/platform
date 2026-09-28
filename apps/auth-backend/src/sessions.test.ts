import { DATABASE } from "@outegro/nest-common";
import { sql } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthDatabase } from "./common/database.js";
import { outbox } from "./db/schema.js";
import { type Harness, startHarness, uniqueEmail } from "./test/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());
beforeEach(() => h.clock.set(new Date()));

const refresh = (refreshToken: string) =>
  h.http().post("/v1/sessions/refresh").send({ refreshToken });

describe("access tokens", () => {
  it("are ES256 JWTs verifiable with the published JWKS", async () => {
    const { accessToken, user, sessionId } = await h.signIn(uniqueEmail());
    const jwks = (await h.http().get("/.well-known/jwks.json").expect(200))
      .body;
    expect(jwks.keys[0]).toMatchObject({
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
    });
    const { payload, protectedHeader } = await jwtVerify(
      accessToken,
      createLocalJWKSet(jwks),
      {
        issuer: "http://identity.test",
        audience: "outegro",
      },
    );
    expect(protectedHeader.kid).toBe(jwks.keys[0].kid);
    expect(payload).toMatchObject({ sub: user.id, sid: sessionId, roles: [] });
  });
});

describe("refresh rotation (ADR-004)", () => {
  it("rotates on every refresh and invalidates nothing legitimate", async () => {
    const first = await h.signIn(uniqueEmail());
    const second = (await refresh(first.refreshToken).expect(200)).body;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const third = (await refresh(second.refreshToken).expect(200)).body;
    await h.http().get("/v1/me").set(h.auth(third.accessToken)).expect(200);
  });

  it("TC-ID-03-01: two tabs refreshing at once both succeed with the same new token", async () => {
    const { refreshToken } = await h.signIn(uniqueEmail());
    const [a, b] = await Promise.all([
      refresh(refreshToken),
      refresh(refreshToken),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.refreshToken).toBe(b.body.refreshToken);
    await refresh(a.body.refreshToken).expect(200);
  });

  it("TC-ID-03-02: a lost response can be retried within the grace window", async () => {
    const { refreshToken } = await h.signIn(uniqueEmail());
    const lost = (await refresh(refreshToken).expect(200)).body;
    const retried = (await refresh(refreshToken).expect(200)).body;
    expect(retried.refreshToken).toBe(lost.refreshToken);
  });

  it("TC-ID-03-03: reuse outside the window burns the session and alerts the user", async () => {
    const { refreshToken, user } = await h.signIn(uniqueEmail());
    const current = (await refresh(refreshToken).expect(200)).body;
    await new Promise((r) => setTimeout(r, 1200)); // grace is 1 s in tests
    await refresh(refreshToken).expect(401);
    // The attacker's reuse also kills the legitimate holder's token.
    await refresh(current.refreshToken).expect(401);
    await h.http().get("/v1/me").set(h.auth(current.accessToken)).expect(401);
    const database = h.app.get<AuthDatabase>(DATABASE);
    const types = await database.db
      .select({
        type: outbox.type,
        template: sql<string>`${outbox.envelope}->'payload'->>'templateKey'`,
      })
      .from(outbox)
      .where(sql`${outbox.envelope}->'payload'->>'userId' = ${user.id}
        or ${outbox.envelope}->'payload'->'recipient'->>'userId' = ${user.id}`);
    expect(types).toEqual(
      expect.arrayContaining([
        { type: "identity.session.revoked.v1", template: null },
        {
          type: "notifications.intent.requested.v1",
          template: "security.session-revoked",
        },
      ]),
    );
  });

  it("rejects garbage and unknown tokens", async () => {
    await refresh("x".repeat(60)).expect(401);
    await refresh(
      `00000000-0000-4000-8000-000000000000.${"a".repeat(43)}`,
    ).expect(401);
  });
});

describe("sessions", () => {
  it("TC-ID-03-04: revoke-all ends other sessions immediately, not at token expiry", async () => {
    const email = uniqueEmail("multi");
    const laptop = await h.signIn(email);
    await h.resetLimits();
    const phone = await h.signIn(email);
    await h.http().get("/v1/me").set(h.auth(laptop.accessToken)).expect(200);
    const res = await h
      .http()
      .post("/v1/me/sessions/revoke-all")
      .set(h.auth(phone.accessToken))
      .send({})
      .expect(200);
    expect(res.body.revoked).toBe(1);
    // The laptop's access token has not expired, yet it no longer works.
    await h.http().get("/v1/me").set(h.auth(laptop.accessToken)).expect(401);
    await refresh(laptop.refreshToken).expect(401);
    await h.http().get("/v1/me").set(h.auth(phone.accessToken)).expect(200);
  });

  it("lists own sessions and cannot revoke someone else's", async () => {
    const mine = await h.signIn(uniqueEmail());
    const theirs = await h.signIn(uniqueEmail());
    const list = await h
      .http()
      .get("/v1/me/sessions")
      .set(h.auth(mine.accessToken))
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: mine.sessionId,
      current: true,
    });
    await h
      .http()
      .delete(`/v1/me/sessions/${theirs.sessionId}`)
      .set(h.auth(mine.accessToken))
      .expect(404);
    await refresh(theirs.refreshToken).expect(200);
  });

  it("logout revokes the session", async () => {
    const { refreshToken, accessToken } = await h.signIn(uniqueEmail());
    await h
      .http()
      .post("/v1/sessions/logout")
      .send({ refreshToken })
      .expect(204);
    await refresh(refreshToken).expect(401);
    await h.http().get("/v1/me").set(h.auth(accessToken)).expect(401);
  });

  it("updates the profile with optimistic concurrency", async () => {
    const { accessToken } = await h.signIn(uniqueEmail());
    const me = (
      await h.http().get("/v1/me").set(h.auth(accessToken)).expect(200)
    ).body;
    const updated = await h
      .http()
      .patch("/v1/me")
      .set(h.auth(accessToken))
      .send({ expectedVersion: me.version, displayName: "Nick", locale: "ru" })
      .expect(200);
    expect(updated.body).toMatchObject({
      displayName: "Nick",
      locale: "ru",
      version: me.version + 1,
    });
    const stale = await h
      .http()
      .patch("/v1/me")
      .set(h.auth(accessToken))
      .send({ expectedVersion: me.version, displayName: "Other" })
      .expect(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
  });
});
