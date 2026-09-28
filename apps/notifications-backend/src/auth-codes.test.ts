import { randomUUID } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationsDatabase } from "./common/database.js";
import { type Harness, startHarness } from "./test/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());
beforeEach(() => {
  h.clock.set(new Date());
  h.email.fail = null;
});

const send = (body: Record<string, unknown>, token = h.internalToken) =>
  h
    .http()
    .post("/v1/internal/auth-codes")
    .set("authorization", `Bearer ${token}`)
    .send(body);
const message = (code = "402913") => ({
  challengeId: randomUUID(),
  email: "nick@example.test",
  code,
  locale: "en",
  expiresAt: new Date(h.clock.now().getTime() + 600_000).toISOString(),
});

describe("login code delivery (N-02, ADR-008)", () => {
  it("TC-N-02-01: delivers the code by email with a stable idempotency key", async () => {
    const body = message("402913");
    const res = await send(body).expect(200);
    expect(res.body).toEqual({ status: "accepted" });
    const sent = h.email.sent.at(-1);
    expect(sent).toMatchObject({
      to: "nick@example.test",
      subject: "Your sign-in code: 402913",
      idempotencyKey: `auth-code:${body.challengeId}`,
    });
    expect(sent?.html).toContain("402913");
    expect(sent?.text).toContain("402913");
  });

  it("renders the Russian email for ru", async () => {
    await send({ ...message("118822"), locale: "ru" }).expect(200);
    expect(h.email.sent.at(-1)?.subject).toBe("Код входа: 118822");
  });

  it("TC-N-02-02: never sends a code after it expired", async () => {
    const before = h.email.attempts.length;
    const res = await send({
      ...message(),
      expiresAt: new Date(h.clock.now().getTime() - 1).toISOString(),
    }).expect(200);
    expect(res.body).toEqual({ status: "failed", reason: "expired" });
    expect(h.email.attempts.length).toBe(before);
  });

  it("TC-N-02-03: reports provider failure instead of hanging", async () => {
    h.email.fail = new Error("connect ECONNREFUSED");
    const res = await send(message()).expect(200);
    expect(res.body).toEqual({ status: "failed", reason: "provider" });
  });

  it("TC-N-02-04: the code is never persisted", async () => {
    const marker = "731905";
    await send(message(marker)).expect(200);
    const database = h.app.get<NotificationsDatabase>(DATABASE);
    const tables = [
      "intents",
      "deliveries",
      "inbox_items",
      "outbox",
      "inbox",
      "recipients",
    ];
    for (const table of tables) {
      const result = await database.db.execute<{ dump: string | null }>(
        sql.raw(`select string_agg(t::text, '') as dump from ${table} t`),
      );
      expect(result.rows[0]?.dump ?? "").not.toContain(marker);
    }
  });

  it("is only reachable with the service token", async () => {
    await h.http().post("/v1/internal/auth-codes").send(message()).expect(401);
    await send(message(), "x".repeat(64)).expect(401);
  });

  it("validates the payload", async () => {
    const res = await send({ ...message(), code: "12ab" }).expect(400);
    expect(res.body.error.fieldErrors.code).toBeDefined();
  });
});
