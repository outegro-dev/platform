import { randomUUID } from "node:crypto";
import { billingGrantChanged, createEvent } from "@outegro/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RolesService } from "./access/roles.service.js";
import { GrantsService } from "./grants/grants.service.js";
import { type Harness, startHarness, uniqueEmail } from "./test/harness.js";

let h: Harness;
let roles: RolesService;
let grants: GrantsService;

beforeAll(async () => {
  h = await startHarness();
  roles = h.app.get(RolesService);
  grants = h.app.get(GrantsService);
});
afterAll(() => h?.close());
beforeEach(() => h.clock.set(new Date()));

/** Owner bootstrap as the CLI does it, then a fresh sign-in carrying the role. */
async function signInAs(role: string, options: { expiresAt?: Date } = {}) {
  const email = uniqueEmail(role);
  const first = await h.signIn(email);
  await roles.grant(
    { userId: null },
    {
      userId: first.user.id,
      role,
      reason: "test setup",
      expiresAt: options.expiresAt ?? null,
    },
  );
  await h.resetLimits();
  return h.signIn(email);
}

const grantEvent = (input: {
  grantId: string;
  userId: string;
  version: number;
  state: "active" | "revoked" | "expired";
  validUntil?: string | null;
  sourceId?: string;
}) =>
  createEvent(billingGrantChanged, {
    aggregateId: input.grantId,
    aggregateVersion: input.version,
    payload: {
      grantId: input.grantId,
      userId: input.userId,
      service: "battleship",
      feature: "pro",
      sourceType: "subscription",
      sourceId: input.sourceId ?? randomUUID(),
      state: input.state,
      validFrom: new Date(h.clock.now().getTime() - 60_000).toISOString(),
      validUntil: input.validUntil ?? null,
    },
  });

describe("roles and permissions", () => {
  it("TC-ID-07-01: the first signup gets no role", async () => {
    const { accessToken } = await h.signIn(uniqueEmail("first"));
    const me = (
      await h.http().get("/v1/me").set(h.auth(accessToken)).expect(200)
    ).body;
    expect(me.roles).toEqual([]);
    expect(me.permissions).toEqual([]);
  });

  it("TC-ID-06-01: a paid grant never opens admin endpoints", async () => {
    const user = await h.signIn(uniqueEmail("paid"));
    await grants.apply(
      grantEvent({
        grantId: randomUUID(),
        userId: user.user.id,
        version: 1,
        state: "active",
      }),
    );
    const mine = await h
      .http()
      .get("/v1/me/grants")
      .set(h.auth(user.accessToken))
      .expect(200);
    expect(mine.body.items).toHaveLength(1);
    await h
      .http()
      .get("/v1/admin/users")
      .set(h.auth(user.accessToken))
      .expect(403);
  });

  it("lets an owner use the admin API and records roles in the token", async () => {
    const owner = await signInAs("owner");
    const list = await h
      .http()
      .get("/v1/admin/users?limit=2")
      .set(h.auth(owner.accessToken))
      .expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(
      list.body.nextCursor === null || typeof list.body.nextCursor === "string",
    ).toBe(true);
    const me = (
      await h.http().get("/v1/me").set(h.auth(owner.accessToken)).expect(200)
    ).body;
    expect(me.roles).toEqual(["owner"]);
  });

  it("limits support to its permissions", async () => {
    const support = await signInAs("support");
    const target = await h.signIn(uniqueEmail("target"));
    await h
      .http()
      .post(`/v1/admin/users/${target.user.id}/role-bindings`)
      .set(h.auth(support.accessToken))
      .send({ role: "owner", reason: "escalation attempt" })
      .expect(403);
    await h
      .http()
      .post(`/v1/admin/users/${target.user.id}/sessions/revoke-all`)
      .set(h.auth(support.accessToken))
      .send({ reason: "customer request" })
      .expect(200);
  });

  it("answers service lookups only with the internal token", async () => {
    const user = await h.signIn(uniqueEmail("lookup"));
    const lookup = (token: string, userId: string) =>
      h
        .http()
        .post("/v1/internal/users/lookup")
        .set("authorization", `Bearer ${token}`)
        .send({ userId });
    await lookup("x".repeat(64), user.user.id).expect(401);
    await lookup(user.accessToken, user.user.id).expect(401);
    const internal = process.env.INTERNAL_API_TOKEN ?? "";
    const found = await lookup(internal, user.user.id).expect(200);
    expect(found.body).toEqual({
      userId: user.user.id,
      email: user.user.email,
      emailVerified: true,
      locale: "en",
      status: "active",
      accessVersion: expect.any(Number),
    });
    await lookup(internal, randomUUID()).expect(404);
  });

  it("gives the dashboard numbers and the audit trail by permission", async () => {
    const owner = await signInAs("owner");
    const overview = await h
      .http()
      .get("/v1/admin/overview")
      .set(h.auth(owner.accessToken))
      .expect(200);
    expect(overview.body.users.total).toBeGreaterThan(0);
    expect(overview.body.sessions.active).toBeGreaterThan(0);
    expect(overview.body.signIns7d.email).toBeGreaterThan(0);
    expect(overview.body.roleBindings.owner).toBeGreaterThan(0);

    const trail = await h
      .http()
      .get(`/v1/admin/audit?targetId=${owner.user.id}`)
      .set(h.auth(owner.accessToken))
      .expect(200);
    expect(trail.body.items.map((i: { action: string }) => i.action)).toContain(
      "role.granted",
    );
    await h
      .http()
      .get("/v1/admin/audit?cursor=bm90LWEtY3Vyc29y")
      .set(h.auth(owner.accessToken))
      .expect(400);

    const support = await signInAs("support");
    await h
      .http()
      .get("/v1/admin/audit")
      .set(h.auth(support.accessToken))
      .expect(403);
    await h
      .http()
      .get("/v1/admin/overview")
      .set(h.auth(support.accessToken))
      .expect(200);
  });

  it("TC-ID-06-03: an expired binding stops working while its token is still valid", async () => {
    const support = await signInAs("support", {
      expiresAt: new Date(Date.now() + 5_000),
    });
    await h
      .http()
      .get("/v1/admin/users")
      .set(h.auth(support.accessToken))
      .expect(200);
    h.clock.advance(10_000);
    await h
      .http()
      .get("/v1/admin/users")
      .set(h.auth(support.accessToken))
      .expect(403);
  });

  it("TC-ID-06-04: unknown roles are rejected and grant nothing", async () => {
    const owner = await signInAs("owner");
    const target = await h.signIn(uniqueEmail("t"));
    const res = await h
      .http()
      .post(`/v1/admin/users/${target.user.id}/role-bindings`)
      .set(h.auth(owner.accessToken))
      .send({ role: "superadmin", reason: "typo" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("owner protection", () => {
  it("TC-ID-07-02: the last owner cannot be removed or suspended", async () => {
    // Make this owner the only active one by revoking every other owner first.
    const owner = await signInAs("owner");
    const detail = await h
      .http()
      .get(`/v1/admin/users/${owner.user.id}`)
      .set(h.auth(owner.accessToken))
      .expect(200);
    const all = await h
      .http()
      .get("/v1/admin/users?limit=100")
      .set(h.auth(owner.accessToken))
      .expect(200);
    for (const user of all.body.items as { id: string }[]) {
      if (user.id === owner.user.id) continue;
      const other = await h
        .http()
        .get(`/v1/admin/users/${user.id}`)
        .set(h.auth(owner.accessToken));
      for (const binding of other.body.roleBindings ?? []) {
        if (binding.role === "owner" && binding.state === "active") {
          await roles.revoke(
            { userId: owner.user.id },
            { bindingId: binding.id, reason: "cleanup" },
          );
        }
      }
    }
    const binding = detail.body.roleBindings.find(
      (b: { role: string }) => b.role === "owner",
    );
    const revoke = await h
      .http()
      .post(`/v1/admin/role-bindings/${binding.id}/revoke`)
      .set(h.auth(owner.accessToken))
      .send({ reason: "leaving" })
      .expect(422);
    expect(revoke.body.error.code).toBe("UNPROCESSABLE");
    await h
      .http()
      .post(`/v1/admin/users/${owner.user.id}/status`)
      .set(h.auth(owner.accessToken))
      .send({ status: "suspended", reason: "mistake" })
      .expect(422);
  });

  it("TC-ID-07-03: two owners removing each other at once leaves one owner", async () => {
    const a = await signInAs("owner");
    const b = await signInAs("owner");
    const bindingOf = async (userId: string) =>
      (
        await h
          .http()
          .get(`/v1/admin/users/${userId}`)
          .set(h.auth(a.accessToken))
          .expect(200)
      ).body.roleBindings.find(
        (x: { role: string; state: string }) =>
          x.role === "owner" && x.state === "active",
      ).id;
    const all = await h
      .http()
      .get("/v1/admin/users?limit=100")
      .set(h.auth(a.accessToken))
      .expect(200);
    for (const user of all.body.items as { id: string }[]) {
      if (user.id === a.user.id || user.id === b.user.id) continue;
      const other = await h
        .http()
        .get(`/v1/admin/users/${user.id}`)
        .set(h.auth(a.accessToken));
      for (const binding of other.body.roleBindings ?? []) {
        if (binding.role === "owner" && binding.state === "active") {
          await roles.revoke(
            { userId: a.user.id },
            { bindingId: binding.id, reason: "cleanup" },
          );
        }
      }
    }
    const [bindingA, bindingB] = await Promise.all([
      bindingOf(a.user.id),
      bindingOf(b.user.id),
    ]);
    const results = await Promise.allSettled([
      roles.revoke(
        { userId: a.user.id },
        { bindingId: bindingB, reason: "race" },
      ),
      roles.revoke(
        { userId: b.user.id },
        { bindingId: bindingA, reason: "race" },
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("grant projection (ID-08)", () => {
  it("TC-ID-08-01: an older version never overwrites a newer one", async () => {
    const user = await h.signIn(uniqueEmail("g1"));
    const grantId = randomUUID();
    await grants.apply(
      grantEvent({
        grantId,
        userId: user.user.id,
        version: 3,
        state: "revoked",
      }),
    );
    await grants.apply(
      grantEvent({
        grantId,
        userId: user.user.id,
        version: 2,
        state: "active",
      }),
    );
    expect(await grants.active(user.user.id)).toEqual([]);
  });

  it("TC-ID-08-02: revoking one of two sources keeps the feature", async () => {
    const user = await h.signIn(uniqueEmail("g2"));
    const [g1, g2] = [randomUUID(), randomUUID()];
    await grants.apply(
      grantEvent({
        grantId: g1,
        userId: user.user.id,
        version: 1,
        state: "active",
      }),
    );
    await grants.apply(
      grantEvent({
        grantId: g2,
        userId: user.user.id,
        version: 1,
        state: "active",
      }),
    );
    await grants.apply(
      grantEvent({
        grantId: g1,
        userId: user.user.id,
        version: 2,
        state: "revoked",
      }),
    );
    const active = await grants.active(user.user.id);
    expect(active.map((g) => g.grantId)).toEqual([g2]);
  });

  it("TC-ID-08-03: expiry is evaluated at read time, no cron needed", async () => {
    const user = await h.signIn(uniqueEmail("g3"));
    const validUntil = new Date(h.clock.now().getTime() + 60_000).toISOString();
    await grants.apply(
      grantEvent({
        grantId: randomUUID(),
        userId: user.user.id,
        version: 1,
        state: "active",
        validUntil,
      }),
    );
    expect(await grants.active(user.user.id)).toHaveLength(1);
    h.clock.advance(61_000);
    expect(await grants.active(user.user.id)).toHaveLength(0);
  });

  it("applies a redelivered event once", async () => {
    const user = await h.signIn(uniqueEmail("g4"));
    const event = grantEvent({
      grantId: randomUUID(),
      userId: user.user.id,
      version: 1,
      state: "active",
    });
    await grants.apply(event);
    await grants.apply(event);
    expect(await grants.active(user.user.id)).toHaveLength(1);
  });
});
