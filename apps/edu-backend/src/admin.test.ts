import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import {
  adminAuditPageSchema,
  adminBookDetailSchema,
  adminBooksResponseSchema,
  adminOverviewSchema,
  adminReadersPageSchema,
  adminUserEducationSchema,
  bookCommandResultSchema,
  type ExerciseAttempt,
} from "@outegro/contracts/edu";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminAudit, books, chapters, readerDays } from "./db/schema.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { attemptsFor, storedExercise } from "./test/fixtures.js";
import { type Harness, startHarness } from "./test/harness.js";

let h: Harness;
let firstExercise: string;
let firstCard: string;
/** The right answer to the first exercise of the Node book. */
let rightAnswer: ExerciseAttempt;

beforeAll(async () => {
  h = await startHarness();
  const [chapter] = await h.db
    .select({ exerciseIds: chapters.exerciseIds, cardIds: chapters.cardIds })
    .from(chapters)
    .innerJoin(books, eq(books.id, chapters.bookId))
    .where(eq(books.slug, "nodejs-internals"))
    .orderBy(asc(chapters.n))
    .limit(1);
  firstExercise = chapter?.exerciseIds[0] ?? "";
  firstCard = chapter?.cardIds[0] ?? "";
  rightAnswer = attemptsFor(
    await storedExercise(h.db, "nodejs-internals", firstExercise),
  ).right;
});
afterAll(() => h?.close());

const paidRule = {
  mode: "grant",
  features: ["library", "book.nodejs-internals"],
  previewChapters: 1,
} as const;

async function get(path: string, userId: string, roles: string[] = []) {
  return h
    .http()
    .get(path)
    .set(await h.auth(userId, roles));
}

async function command(
  path: string,
  actor: { userId: string; roles: string[]; accessVersion?: number },
  body: object,
) {
  return h
    .http()
    .post(path)
    .set(await h.auth(actor.userId, actor.roles, actor.accessVersion ?? 0))
    .send(body);
}

async function versionOf(slug: string) {
  const [row] = await h.db
    .select({ version: books.version, status: books.status, rule: books.rule })
    .from(books)
    .where(eq(books.slug, slug));
  if (!row) throw new Error(`no book ${slug}`);
  return row;
}

const auditCount = async () => (await h.db.select().from(adminAudit)).length;

/** A reader who answered, marked and moved through the reader API. */
async function reader(
  options: { grant?: boolean; lastChapter?: number; slug?: string } = {},
) {
  const userId = randomUUID();
  const auth = await h.auth(userId);
  const slug = options.slug ?? "nodejs-internals";
  if (options.grant)
    await h.get(GrantsConsumer).apply(h.grantEvent({ userId }));
  if (slug === "nodejs-internals") {
    await h
      .http()
      .post(`/v1/me/books/${slug}/exercises/${firstExercise}/attempts`)
      .set(auth)
      .send(rightAnswer)
      .expect(200, { correct: true, solved: true });
    await h
      .http()
      .put(`/v1/me/books/${slug}/cards/${firstCard}`)
      .set(auth)
      .send({ state: "know" })
      .expect(200);
  }
  await h
    .http()
    .patch(`/v1/me/books/${slug}/progress`)
    .set(auth)
    .send({ lastChapter: options.lastChapter ?? 1 })
    .expect(200);
  return userId;
}

describe("permissions (TC-EDU-06)", () => {
  const routes: ["get" | "post", string][] = [
    ["get", "/v1/admin/overview"],
    ["get", "/v1/admin/books"],
    ["get", "/v1/admin/books/nodejs-internals"],
    ["post", "/v1/admin/books/nodejs-internals/status"],
    ["post", "/v1/admin/books/nodejs-internals/access"],
    ["get", "/v1/admin/readers"],
    ["get", `/v1/admin/readers/${randomUUID()}`],
    ["get", "/v1/admin/audit"],
  ];
  const body = { status: "draft", expectedVersion: 0, reason: "because" };

  it("every admin route needs a token (401) and its permission (403)", async () => {
    for (const [method, path] of routes) {
      const response = await h.http()[method](path).send(body);
      expect([path, response.status]).toEqual([path, 401]);
    }
    for (const roles of [[], ["billing_operator"], ["auditor"], ["pro"]]) {
      const headers = await h.auth(randomUUID(), roles);
      for (const [method, path] of routes) {
        const response = await h.http()[method](path).set(headers).send(body);
        expect([roles, path, response.status]).toEqual([roles, path, 403]);
      }
    }
  });

  it("support reads everything but cannot command", async () => {
    const headers = await h.auth(randomUUID(), ["support"]);
    const before = await versionOf("nodejs-internals");
    for (const [method, path] of routes) {
      const response = await h.http()[method](path).set(headers).send(body);
      const expected =
        method === "post" ? 403 : path.includes("/readers/") ? 404 : 200;
      expect([path, response.status]).toEqual([path, expected]);
    }
    expect(await versionOf("nodejs-internals")).toEqual(before);
  });
});

describe("books", () => {
  it("list every book with its rule, content version and readers", async () => {
    // The first readers of this database: two in the Node book, one in SQL.
    await reader({ lastChapter: 1 });
    await reader({ grant: true, lastChapter: 5 });
    await reader({ slug: "sql-internals" });
    const list = adminBooksResponseSchema.parse(
      (await get("/v1/admin/books", randomUUID(), ["support"])).body,
    );
    expect(list.items.map((book) => book.slug)).toEqual([
      "nodejs-internals",
      "sql-internals",
    ]);
    const node = list.items[0];
    expect(node).toMatchObject({
      title: "Node.js изнутри",
      status: "published",
      rule: paidRule,
      contentVersion: 1,
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      stats: { chapters: 13, exercises: 76, cards: 122 },
      importedAt: "2026-09-29T10:00:00.000Z",
      publishedAt: "2026-09-29T10:00:00.000Z",
      version: 0,
      readers: 2,
    });
    expect(list.items[1]?.readers).toBe(1);

    const detail = adminBookDetailSchema.parse(
      (await get("/v1/admin/books/nodejs-internals", randomUUID(), ["support"]))
        .body,
    );
    expect(detail.chapters).toHaveLength(13);
    expect(detail.chapters[0]).toMatchObject({
      n: 1,
      short: "Устройство",
      exercises: expect.any(Number),
      cards: expect.any(Number),
    });
    // Both readers reached chapter 1; only the one with a grant got to 5.
    expect(detail.chapters.map((chapter) => chapter.reached)).toEqual([
      2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    for (const slug of ["no-such-book", "Not_A_Slug"])
      expect(
        (await get(`/v1/admin/books/${slug}`, randomUUID(), ["support"]))
          .status,
      ).toBe(404);
  });
});

describe("commands (TC-EDU-06)", () => {
  const editor = { userId: randomUUID(), roles: ["edu_editor"] };
  const owner = { userId: randomUUID(), roles: ["owner"] };
  const statusPath = "/v1/admin/books/nodejs-internals/status";
  const accessPath = "/v1/admin/books/nodejs-internals/access";

  it("edu_editor and owner publish, archive and change access, each with its audit row (TC-EDU-02)", async () => {
    const start = await versionOf("nodejs-internals");
    h.clock.advance(1_000);
    const drafted = await command(statusPath, editor, {
      status: "draft",
      expectedVersion: start.version,
      reason: "  Готовим второе издание  ",
    });
    expect(drafted.status).toBe(200);
    expect(bookCommandResultSchema.parse(drafted.body)).toEqual({
      slug: "nodejs-internals",
      status: "draft",
      rule: paidRule,
      version: start.version + 1,
    });
    const [entry] = await h.db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, "book.status.changed"));
    expect(entry).toMatchObject({
      actorId: editor.userId,
      targetType: "book",
      targetId: "nodejs-internals",
      reason: "Готовим второе издание",
      data: { before: { status: "published" }, after: { status: "draft" } },
      at: h.clock.now(),
    });
    // Readers lose the draft at once; staff keep it.
    const reading = randomUUID();
    expect((await get("/v1/books/nodejs-internals", reading)).status).toBe(404);
    expect(
      (await get("/v1/books", reading)).body.books.map(
        (book: { slug: string }) => book.slug,
      ),
    ).toEqual(["sql-internals"]);
    expect(
      (await get("/v1/books/nodejs-internals", reading, ["edu_editor"])).status,
    ).toBe(200);

    h.clock.advance(1_000);
    const published = await command(statusPath, owner, {
      status: "published",
      expectedVersion: start.version + 1,
      reason: "Второе издание готово",
    });
    expect(published.body).toMatchObject({
      status: "published",
      version: start.version + 2,
    });
    const [row] = await h.db
      .select({ publishedAt: books.publishedAt, updatedAt: books.updatedAt })
      .from(books)
      .where(eq(books.slug, "nodejs-internals"));
    expect(row).toEqual({
      publishedAt: h.clock.now(),
      updatedAt: h.clock.now(),
    });

    h.clock.advance(1_000);
    const opened = await command(accessPath, editor, {
      rule: { mode: "free" },
      expectedVersion: start.version + 2,
      reason: "Открываем книгу всем",
    });
    expect(opened.body).toEqual({
      slug: "nodejs-internals",
      status: "published",
      rule: { mode: "free" },
      version: start.version + 3,
    });
    expect(
      (await h.http().get("/v1/books/nodejs-internals/chapters/7")).body,
    ).toMatchObject({ access: "open" });

    h.clock.advance(1_000);
    const closed = await command(accessPath, owner, {
      rule: paidRule,
      expectedVersion: start.version + 3,
      reason: "Снова по подписке",
    });
    expect(closed.status).toBe(200);
    expect(
      (await h.http().get("/v1/books/nodejs-internals/chapters/7")).status,
    ).toBe(401);

    const audit = adminAuditPageSchema.parse(
      (
        await get("/v1/admin/audit?targetId=nodejs-internals", randomUUID(), [
          "support",
        ])
      ).body,
    );
    expect(audit.items.map((item) => item.action)).toEqual([
      "book.access.changed",
      "book.access.changed",
      "book.status.changed",
      "book.status.changed",
      "book.imported",
    ]);
    expect(audit.items[0]).toMatchObject({
      actorId: owner.userId,
      reason: "Снова по подписке",
      data: { before: { rule: { mode: "free" } }, after: { rule: paidRule } },
    });
    expect(audit.items[4]).toMatchObject({
      actorId: null,
      reason: null,
      data: { contentVersion: 1, contentHash: expect.any(String) },
    });
  });

  it("need a reason, the current version and a real change", async () => {
    const current = await versionOf("nodejs-internals");
    const audited = await auditCount();
    const cases: [string, object, number, string][] = [
      [
        statusPath,
        { status: "draft", expectedVersion: current.version, reason: "x" },
        400,
        "VALIDATION_FAILED",
      ],
      [
        statusPath,
        { status: "draft", reason: "no version given" },
        400,
        "VALIDATION_FAILED",
      ],
      [
        statusPath,
        {
          status: "draft",
          expectedVersion: current.version,
          reason: "extra field",
          force: true,
        },
        400,
        "VALIDATION_FAILED",
      ],
      [
        accessPath,
        {
          rule: { mode: "public" },
          expectedVersion: current.version,
          reason: "no such mode",
        },
        400,
        "VALIDATION_FAILED",
      ],
      [
        statusPath,
        {
          status: "draft",
          expectedVersion: current.version + 7,
          reason: "stale console",
        },
        409,
        "VERSION_CONFLICT",
      ],
      [
        statusPath,
        {
          status: "published",
          expectedVersion: current.version,
          reason: "already so",
        },
        422,
        "UNPROCESSABLE",
      ],
      [
        accessPath,
        {
          rule: {
            previewChapters: 1,
            features: ["library", "book.nodejs-internals"],
            mode: "grant",
          },
          expectedVersion: current.version,
          reason: "same rule",
        },
        422,
        "UNPROCESSABLE",
      ],
      [
        accessPath,
        {
          rule: {
            mode: "grant",
            features: ["book.nodejs-internals", "library"],
            previewChapters: 1,
          },
          expectedVersion: current.version,
          reason: "same features in another order",
        },
        422,
        "UNPROCESSABLE",
      ],
      [
        accessPath,
        {
          rule: { mode: "grant", features: ["library"], previewChapters: 14 },
          expectedVersion: current.version,
          reason: "too many previews",
        },
        422,
        "UNPROCESSABLE",
      ],
      [
        "/v1/admin/books/no-such-book/status",
        { status: "draft", expectedVersion: 0, reason: "missing book" },
        404,
        "NOT_FOUND",
      ],
    ];
    for (const [path, body, status, code] of cases) {
      const response = await command(path, editor, body);
      expect([body, response.status, response.body.error?.code]).toEqual([
        body,
        status,
        code,
      ]);
    }
    const conflict = await command(statusPath, editor, {
      status: "draft",
      expectedVersion: current.version + 7,
      reason: "stale console",
    });
    expect(conflict.body.error.fieldErrors).toEqual({
      version: [String(current.version)],
    });
    expect(await versionOf("nodejs-internals")).toEqual(current);
    expect(await auditCount()).toBe(audited);
  });

  it("change nothing when the audit row cannot be written (one transaction)", async () => {
    const current = await versionOf("sql-internals");
    await h.db.execute(sql`
      create function refuse_audit() returns trigger language plpgsql
        as $$ begin raise exception 'audit unavailable'; end $$`);
    await h.db.execute(sql`
      create trigger refuse_audit before insert on admin_audit
        for each row execute function refuse_audit()`);
    const logged = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    try {
      const response = await command(
        "/v1/admin/books/sql-internals/status",
        owner,
        {
          status: "archived",
          expectedVersion: current.version,
          reason: "retire it",
        },
      );
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL");
      expect(JSON.stringify(response.body)).not.toContain("audit unavailable");
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/v1/admin/books/sql-internals/status",
        }),
        "Request failed",
      );
    } finally {
      logged.mockRestore();
      await h.db.execute(sql`drop trigger refuse_audit on admin_audit`);
      await h.db.execute(sql`drop function refuse_audit()`);
    }
    expect(await versionOf("sql-internals")).toEqual(current);
  });

  it("need a token issued after the actor's latest role change; a suspended actor cannot", async () => {
    const identity = h.get(IdentityConsumer);
    const actor = { userId: randomUUID(), roles: ["edu_editor"] };
    await identity.apply(h.roleEvent(actor.userId, "edu_editor", 3));
    const current = await versionOf("sql-internals");
    const body = {
      status: "draft",
      expectedVersion: current.version,
      reason: "Пересобираем главы",
    };
    const stale = await command(
      "/v1/admin/books/sql-internals/status",
      actor,
      body,
    );
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe("UNAUTHENTICATED");
    // Reads do not need a fresh token.
    expect(
      (await get("/v1/admin/books", actor.userId, actor.roles)).status,
    ).toBe(200);
    const fresh = await command(
      "/v1/admin/books/sql-internals/status",
      { ...actor, accessVersion: 3 },
      body,
    );
    expect(fresh.status).toBe(200);
    await identity.apply(h.statusEvent(actor.userId, "suspended", 4));
    const suspended = await command(
      "/v1/admin/books/sql-internals/status",
      { ...actor, accessVersion: 4 },
      { ...body, status: "published", expectedVersion: current.version + 1 },
    );
    expect(suspended.status).toBe(403);
    // Leave the book published for the tests that follow.
    await command(
      "/v1/admin/books/sql-internals/status",
      { ...owner },
      { ...body, status: "published", expectedVersion: current.version + 1 },
    ).then((response) => expect(response.status).toBe(200));
  });
});

describe("readers", () => {
  it("page newest first with an opaque cursor, by book and by user", async () => {
    const ids: string[] = [];
    for (const lastChapter of [1, 1, 1]) {
      h.clock.advance(60_000);
      ids.push(await reader({ lastChapter }));
    }
    const granted = ids[2] ?? "";
    await h.get(GrantsConsumer).apply(h.grantEvent({ userId: granted }));
    h.clock.advance(60_000);
    await reader({ slug: "sql-internals" });
    const staff = randomUUID();
    const page = async (query: string) => {
      const response = await get(`/v1/admin/readers?${query}`, staff, [
        "support",
      ]);
      expect(response.status).toBe(200);
      return adminReadersPageSchema.parse(response.body);
    };
    const first = await page("book=nodejs-internals&limit=2");
    expect(first.items.map((item) => item.userId)).toEqual([ids[2], ids[1]]);
    expect(first.items[0]).toMatchObject({
      book: "nodejs-internals",
      exercisesSolved: 1,
      exercisesTotal: 76,
      cardsKnown: 1,
      cardsTotal: 122,
      lastChapter: 1,
      access: "granted",
    });
    expect(first.items[1]?.access).toBe("preview");
    const second = await page(
      `book=nodejs-internals&limit=2&cursor=${first.nextCursor}`,
    );
    expect(second.items[0]?.userId).toBe(ids[0]);
    const everyone = await page("limit=100");
    expect(everyone.items[0]?.book).toBe("sql-internals");
    const times = everyone.items.map((item) => item.lastActiveAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(everyone.nextCursor).toBeNull();
    const mine = await page(`userId=${granted}`);
    expect(mine.items.map((item) => [item.userId, item.book])).toEqual([
      [granted, "nodejs-internals"],
    ]);
    expect((await page("book=no-such-book")).items).toEqual([]);
    for (const query of ["book=Not_A_Slug", "userId=nope", "limit=500"])
      expect(
        (await get(`/v1/admin/readers?${query}`, staff, ["support"])).status,
      ).toBe(400);
  });

  it("a tampered cursor is 400, never 500", async () => {
    const id = randomUUID();
    const cursor = (at: string) =>
      encodeURIComponent(Buffer.from(`${at}|${id}`).toString("base64url"));
    const staff = randomUUID();
    for (const value of [
      "garbage",
      cursor("-100000-01-01T00:00:00.000Z"),
      cursor("0000-01-01T00:00:00.000Z"),
      cursor("+275760-09-13T00:00:00.000Z"),
      encodeURIComponent(
        Buffer.from("2026-09-29T10:00:00.000Z|x").toString("base64url"),
      ),
    ])
      for (const path of ["/v1/admin/readers", "/v1/admin/audit"]) {
        const response = await get(`${path}?cursor=${value}`, staff, [
          "support",
        ]);
        expect([path, value, response.status]).toEqual([path, value, 400]);
      }
    expect(
      (
        await get(
          `/v1/admin/readers?cursor=${cursor("2026-09-29T10:00:00.000Z")}`,
          staff,
          ["support"],
        )
      ).status,
    ).toBe(200);
  });

  it("one user: every edu grant and the progress in each book; 404 for a stranger", async () => {
    const userId = await reader({ lastChapter: 1 });
    const consumer = h.get(GrantsConsumer);
    await consumer.apply(
      h.grantEvent({ userId, feature: "book.sql-internals" }),
    );
    await consumer.apply(
      h.grantEvent({
        userId,
        feature: "library",
        validUntil: new Date(h.clock.now().getTime() - 1).toISOString(),
      }),
    );
    const staff = randomUUID();
    const response = await get(`/v1/admin/readers/${userId}`, staff, [
      "support",
    ]);
    expect(response.status).toBe(200);
    const education = adminUserEducationSchema.parse(response.body);
    expect(education.userId).toBe(userId);
    expect(
      education.grants.map((grant) => [grant.feature, grant.inForce]).sort(),
    ).toEqual([
      ["book.sql-internals", true],
      ["library", false],
    ]);
    expect(education.books).toEqual([
      expect.objectContaining({
        userId,
        book: "nodejs-internals",
        access: "preview",
        exercisesSolved: 1,
      }),
    ]);
    const buyer = randomUUID();
    await consumer.apply(h.grantEvent({ userId: buyer }));
    const onlyGrant = adminUserEducationSchema.parse(
      (await get(`/v1/admin/readers/${buyer}`, staff, ["support"])).body,
    );
    expect([onlyGrant.grants.length, onlyGrant.books]).toEqual([1, []]);
    for (const id of [randomUUID(), "not-a-uuid"])
      expect(
        (await get(`/v1/admin/readers/${id}`, staff, ["support"])).status,
      ).toBe(404);
  });
});

describe("overview", () => {
  it("counts books, readers, grants, solved exercises and 14 days of activity", async () => {
    const staff = randomUUID();
    const overview = async () =>
      adminOverviewSchema.parse(
        (await get("/v1/admin/overview", staff, ["support"])).body,
      );
    const before = await overview();
    const today = h.clock.now().toISOString().slice(0, 10);
    const daysAgo = (n: number) =>
      new Date(h.clock.now().getTime() - n * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const someone = randomUUID();
    await h.db.insert(readerDays).values([
      { userId: someone, day: daysAgo(3) },
      { userId: someone, day: daysAgo(13) },
      { userId: someone, day: daysAgo(14) },
    ]);
    const fresh = await reader({ grant: true, lastChapter: 2 });
    const after = await overview();
    expect(after.activity).toHaveLength(14);
    expect(after.activity[0]?.day).toBe(daysAgo(13));
    expect(after.activity.at(-1)?.day).toBe(today);
    const delta = (day: string) =>
      (after.activity.find((d) => d.day === day)?.readers ?? 0) -
      (before.activity.find((d) => d.day === day)?.readers ?? 0);
    expect([delta(today), delta(daysAgo(3)), delta(daysAgo(13))]).toEqual([
      1, 1, 1,
    ]);
    expect(after.activity.some((d) => d.day === daysAgo(14))).toBe(false);
    expect(after.activity.find((d) => d.day === daysAgo(5))?.readers).toBe(0);
    expect(after.readers.total - before.readers.total).toBe(1);
    expect(after.readers.active7d - before.readers.active7d).toBe(1);
    expect(after.grants.inForce - before.grants.inForce).toBe(1);
    expect(after.exercisesSolved7d - before.exercisesSolved7d).toBe(1);
    expect(after.books).toEqual({ published: 2, draft: 0, archived: 0 });
    expect(fresh).toBeTruthy();
  });
});
