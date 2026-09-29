import { randomUUID } from "node:crypto";
import { DATABASE, MetricsServer } from "@outegro/nest-common";
import { idLikeLabelValues, metricValue } from "@outegro/nest-common/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthDatabase } from "./common/database.js";
import { loginChallenges, outbox, users } from "./db/schema.js";
import { type Harness, startHarness, uniqueEmail } from "./test/harness.js";

let h: Harness;
let database: AuthDatabase;

beforeAll(async () => {
  h = await startHarness();
  database = h.app.get(DATABASE);
});
afterAll(() => h?.close());
beforeEach(async () => {
  h.clock.set(new Date());
  h.delivery.status = "accepted";
  await h.valkey.flushdb();
});

const challenge = async (email: string) =>
  (
    await h
      .http()
      .post("/v1/login/challenges")
      .send({ email, locale: "ru" })
      .expect(201)
  ).body;
const verify = (challengeId: string, code: string) =>
  h.http().post("/v1/login/challenges/verify").send({ challengeId, code });

describe("requesting a code", () => {
  it("answers the same for unknown emails and creates no account", async () => {
    const email = uniqueEmail();
    const body = await challenge(email);
    expect(body).toMatchObject({
      challengeId: expect.any(String),
      deliveryStatus: "accepted",
    });
    expect(
      await database.db.select().from(users).where(eq(users.email, email)),
    ).toEqual([]);
  });

  it("stores only an HMAC of the code and keeps it out of events", async () => {
    const email = uniqueEmail();
    const { challengeId } = await challenge(email);
    const { code } = h.delivery.codeFor(email);
    const [row] = await database.db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.id, challengeId));
    expect(row?.codeHash).not.toContain(code);
    const [{ dump } = { dump: "" }] = await database.db
      .select({
        dump: sql<string>`coalesce(string_agg(envelope::text, ''), '')`,
      })
      .from(outbox);
    expect(dump).not.toContain(code);
  });

  it("enforces the resend cooldown per email", async () => {
    const email = uniqueEmail();
    await challenge(email);
    const again = await h
      .http()
      .post("/v1/login/challenges")
      .send({ email })
      .expect(429);
    expect(again.body.error.code).toBe("RATE_LIMITED");
  });

  it("reports a failed delivery instead of pretending success", async () => {
    h.delivery.status = "failed";
    expect((await challenge(uniqueEmail())).deliveryStatus).toBe("failed");
  });
});

describe("verifying a code", () => {
  it("TC-ID-01-01: a code works exactly once", async () => {
    const email = uniqueEmail();
    const { challengeId } = await challenge(email);
    const { code } = h.delivery.codeFor(email);
    const first = await verify(challengeId, code).expect(200);
    expect(first.body.user.email).toBe(email);
    expect(first.body.user.locale).toBe("ru");
    const second = await verify(challengeId, code).expect(422);
    expect(second.body.error.fieldErrors.code).toEqual(["invalid_code"]);
  });

  it("TC-ID-01-02: an expired code is rejected even when correct", async () => {
    const email = uniqueEmail();
    const { challengeId } = await challenge(email);
    h.clock.advance(601_000);
    const res = await verify(
      challengeId,
      h.delivery.codeFor(email).code,
    ).expect(422);
    expect(res.body.error.fieldErrors.code).toEqual(["expired"]);
  });

  it("TC-ID-01-03: the attempt budget ends the challenge, even for the right code", async () => {
    const email = uniqueEmail();
    const { challengeId } = await challenge(email);
    const { code } = h.delivery.codeFor(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await verify(challengeId, wrong).expect(422);
    const fifth = await verify(challengeId, wrong).expect(422);
    expect(fifth.body.error.fieldErrors.code).toEqual(["too_many_attempts"]);
    const right = await verify(challengeId, code).expect(422);
    expect(right.body.error.fieldErrors.code).toEqual(["too_many_attempts"]);
  });

  it("TC-ID-01-04: two concurrent verifications create one session", async () => {
    const email = uniqueEmail();
    const { challengeId } = await challenge(email);
    const { code } = h.delivery.codeFor(email);
    const results = await Promise.all([
      verify(challengeId, code),
      verify(challengeId, code),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  });

  it("creates the user once, marks the email verified and emits events", async () => {
    const email = uniqueEmail();
    const first = await h.signIn(email);
    await h.resetLimits();
    const second = await h.signIn(email);
    expect(second.user.id).toBe(first.user.id);
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    expect(user?.emailVerified).toBe(true);
    const events = await database.db
      .select({ type: outbox.type })
      .from(outbox)
      .where(sql`${outbox.envelope}->>'aggregateId' = ${first.user.id}`);
    expect(events.map((e) => e.type).sort()).toEqual([
      "identity.user.contact.changed.v1",
      "identity.user.created.v1",
    ]);
  });

  it("rejects malformed input with field errors", async () => {
    const res = await h
      .http()
      .post("/v1/login/challenges/verify")
      .send({ challengeId: "nope", code: "12" })
      .expect(400);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      "challengeId",
      "code",
    ]);
  });
});

describe("metrics and correlation (OPS-04)", () => {
  const signIns = (result: string) =>
    h.metric("identity_sign_in_attempts_total", { method: "email", result });
  const codes = (result: string) =>
    h.metric("identity_login_codes_total", { result });

  it("counts sign-ins and login codes by result", async () => {
    const before = await Promise.all([
      signIns("success"),
      signIns("invalid_code"),
      codes("accepted"),
      codes("failed"),
    ]);
    const email = uniqueEmail();
    const { challengeId } = await challenge(email);
    const { code } = h.delivery.codeFor(email);
    await verify(challengeId, code === "000000" ? "111111" : "000000").expect(
      422,
    );
    await verify(challengeId, code).expect(200);
    h.delivery.status = "failed";
    await challenge(uniqueEmail());
    expect(
      await Promise.all([
        signIns("success"),
        signIns("invalid_code"),
        codes("accepted"),
        codes("failed"),
      ]),
    ).toEqual(before.map((count) => count + 1));
  });

  it("the events a sign-in writes carry its request id", async () => {
    const email = uniqueEmail();
    const { challengeId } = await challenge(email);
    const signedIn = await h
      .http()
      .post("/v1/login/challenges/verify")
      .set("x-request-id", "req-signin-00000001")
      .send({ challengeId, code: h.delivery.codeFor(email).code })
      .expect(200);
    const events = await database.db
      .select({ envelope: outbox.envelope })
      .from(outbox)
      .where(
        sql`${outbox.envelope}->>'aggregateId' = ${signedIn.body.user.id}`,
      );
    expect(events).toHaveLength(2);
    for (const { envelope } of events)
      expect(envelope).toMatchObject({
        correlationId: "req-signin-00000001",
        causationId: "req-signin-00000001",
      });
  });

  it("routes are recorded by template, without probes, ids or emails", async () => {
    const session = await h.signIn(uniqueEmail());
    const sessionId = randomUUID();
    await h
      .http()
      .delete(`/v1/me/sessions/${sessionId}`)
      .set(h.auth(session.accessToken))
      .expect(404);
    await h.http().get(`/v1/nope/${sessionId}`).expect(404);
    await h.http().get("/health").expect(200);
    await h.http().get("/health/deep").expect(200);
    const scrape = await h.scrape();
    const requests = (labels: Record<string, string>) =>
      metricValue(scrape, "http_server_requests_total", labels);
    expect(
      requests({
        method: "DELETE",
        route: "/v1/me/sessions/:id",
        status_class: "4xx",
      }),
    ).toBe(1);
    expect(requests({ route: "/v1/login/challenges/verify" })).toBeGreaterThan(
      0,
    );
    expect(requests({ route: "unmatched" })).toBeGreaterThan(0);
    expect(scrape).not.toContain('route="/health');
    expect(scrape).not.toContain(sessionId);
    expect(idLikeLabelValues(scrape)).toEqual([]);
    // METRICS_PORT=0 in tests: nothing listens.
    expect(h.app.get(MetricsServer).port).toBeNull();
  });
});
