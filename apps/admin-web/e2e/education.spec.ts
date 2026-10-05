import type { Locator, Page } from "@playwright/test";
import {
  expect,
  expectNoSideScroll,
  openUserTab,
  phone,
  settle,
  signIn,
  test,
  tracedRequests,
  useRussian,
  visit,
  withFailure,
} from "./fixtures";

/** A user card's address: /users/<uuid>. */
const USER_CARD = /\/users\/[0-9a-f]{8}-[0-9a-f-]{27}$/;

const sidebarLinks = (page: Page) =>
  page
    .getByRole("navigation", { name: "Console sections" })
    .getByRole("link")
    .allTextContents();

/** One number of a panel, by its exact label. */
const stat = (panel: Locator, label: string) =>
  panel.locator(".stat").filter({
    has: panel.page().locator(".stat-label").getByText(label, { exact: true }),
  });

/** One fact of a panel (a term and its description), by its exact term. */
const fact = (panel: Locator, term: string) =>
  panel.locator(".fact").filter({
    has: panel.page().locator("dt").getByText(term, { exact: true }),
  });

/** Publishes the open book again; every test leaves the SQL book published. */
async function publishAgain(page: Page, reason: string) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const publish = page.getByRole("dialog", { name: "Publish this book?" });
  await publish.getByLabel("Reason").fill(reason);
  await publish.getByRole("button", { name: "Publish book" }).click();
  await expect(publish).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Book published."),
  ).toBeVisible();
  await expect(page.locator("#book .status")).toHaveText("Published");
}

test.describe("the SQL book's status", () => {
  // Both tests change the same book: one after the other, never at once.
  test.describe.configure({ mode: "serial" });

  test("a book goes back to draft and is published again, each with a reason", async ({
    page,
  }) => {
    await signIn(page, "owner", "/education/books");
    await page.getByRole("link", { name: "SQL изнутри" }).click();
    await settle(page);
    const book = page.locator("#book");
    await expect(book.locator(".status")).toHaveText("Published");

    await page.getByRole("button", { name: "Back to draft" }).click();
    const draft = page.getByRole("dialog", {
      name: "Move this book back to draft?",
    });
    await expect(
      draft.getByRole("list", { name: "What happens" }),
    ).toContainText("Readers can no longer open it, even with a grant.");
    await draft.getByLabel("Reason").fill("Chapter 9 is being rewritten");
    await draft.getByRole("button", { name: "Move to draft" }).click();
    await expect(draft).toBeHidden();
    await expect(
      page.getByRole("status").getByText("Book moved back to draft."),
    ).toBeVisible();
    await expect(book.locator(".status")).toHaveText("Draft");
    await expect(
      page.getByRole("button", { name: "Back to draft" }),
    ).toHaveCount(0);

    await publishAgain(page, "Chapter 9 rewritten and proofread");

    // The book's own log and the section's audit keep both reasons, and
    // each change says what the status was and what it became (an arrow
    // to the eye, "was …, now …" to a screen reader).
    const log = page.locator("#book-audit");
    await expect(log).toContainText("“Chapter 9 is being rewritten”");
    await expect(log).toContainText("“Chapter 9 rewritten and proofread”");
    for (const change of [
      "was Published, now Draft",
      "was Draft, now Published",
    ]) {
      const line = log.locator(".feed-change").filter({ hasText: change });
      await expect(line.first()).toBeVisible();
      await expect(line.first().locator("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
    await page
      .getByRole("navigation", { name: "Education sections" })
      .getByRole("link", { name: "Audit" })
      .click();
    await settle(page);
    const audit = page.locator("#education-audit");
    await expect(audit).toContainText("“Chapter 9 is being rewritten”");
    await expect(audit).toContainText("Status changed · Book sql-internals");
    // Content imports have no actor: the feed says where they came from.
    await expect(audit).toContainText("by the content import");
  });

  test("a change made meanwhile wins: the stale command is refused and the page catches up", async ({
    page,
    context,
  }) => {
    await signIn(page, "owner", "/education/books/sql-internals");
    await page.getByRole("button", { name: "Change access" }).click();
    const stale = page.getByRole("dialog", {
      name: "Change who reads this book",
    });
    await stale.getByLabel("Reason").fill("Open the first two chapters");

    // Meanwhile another tab moves the book back to draft.
    const other = await context.newPage();
    await other.goto("/education/books/sql-internals");
    await settle(other);
    await other.getByRole("button", { name: "Back to draft" }).click();
    const draft = other.getByRole("dialog", {
      name: "Move this book back to draft?",
    });
    await draft.getByLabel("Reason").fill("Proofreading chapter 4 again");
    await draft.getByRole("button", { name: "Move to draft" }).click();
    await expect(
      other.getByRole("status").getByText("Book moved back to draft."),
    ).toBeVisible();
    await other.close();

    // The open dialog still carries the old version: refused, and the page
    // now shows the book as it is.
    await stale.getByRole("button", { name: "Change access" }).click();
    await expect(
      page
        .locator(".toast")
        .filter({ hasText: "Someone changed these settings a moment ago" }),
    ).toBeVisible();
    await expect(page.locator("#book .status")).toHaveText("Draft");

    await publishAgain(page, "Chapter 4 proofread");
  });
});

test("the access rule changes with a reason; the same rule again changes nothing", async ({
  page,
}) => {
  await signIn(page, "owner", "/education/books/nodejs-internals");
  const book = page.locator("#book");
  await expect(book).toContainText(
    "Opens with a grant for the library or this book.",
  );

  await page.getByRole("button", { name: "Change access" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Change who reads this book",
  });
  await expect(dialog.getByLabel("Who reads")).toHaveValue("grant");
  await dialog.getByLabel("Grant that opens it").selectOption("library");
  await dialog.getByLabel("Free chapters").fill("2");
  await dialog
    .getByLabel("Reason")
    .fill("Two free chapters for the launch week");
  await dialog.getByRole("button", { name: "Change access" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Access rule changed."),
  ).toBeVisible();
  await expect(book).toContainText("Opens with a grant for the library.");
  await expect(book).toContainText(
    "The first 2 chapters are free to signed-in readers.",
  );
  await expect(book).toContainText("edu:library");
  // The free chapters are marked in the table.
  await expect(page.locator("#chapters .chip")).toHaveCount(2);

  // Confirming the same rule again: Education refuses and the dialog says why.
  await page.getByRole("button", { name: "Change access" }).click();
  await dialog.getByLabel("Reason").fill("Pressed it twice");
  await dialog.getByRole("button", { name: "Change access" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Nothing changed: this is already the book's access rule.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const log = page.locator("#book-audit");
  await expect(log).toContainText("“Two free chapters for the launch week”");
  // The rule before and after, in the console's words.
  await expect(
    log.locator(".feed-change").filter({
      hasText:
        "was Paid · Library or this book · 1 free chapter, now Paid · Library only · 2 free chapters",
    }),
  ).toHaveCount(1);
});

test("the audit shows each access change from what it was to what it became", async ({
  page,
}) => {
  await signIn(page, "owner", "/education/audit?book=nodejs-internals");
  // Recorded ten days ago: two free chapters became one.
  const change = page
    .locator("#education-audit .feed-item")
    .filter({ hasText: "“One free chapter is enough to judge the book”" });
  await expect(change).toContainText(
    "Access rule changed · Book nodejs-internals",
  );
  await expect(change.locator(".feed-change")).toHaveText(
    "was Paid · Library or this book · 2 free chapters, now Paid · Library or this book · 1 free chapter",
  );
  // An import changes content, not status or rule: no before and after.
  await expect(
    page
      .locator("#education-audit .feed-item")
      .filter({ hasText: "by the content import" })
      .locator(".feed-change"),
  ).toHaveCount(0);
});

test.describe("an Education audit action newer than the console", () => {
  test.use({ userAgent: withFailure("fake-audit=future") });

  test("shows as another action with its code, and the feeds read on", async ({
    page,
  }) => {
    await signIn(page, "owner", "/education/audit");
    const audit = page.locator("#education-audit");
    const newer = audit
      .locator(".feed-item")
      .filter({ hasText: "book.cover.changed" });
    await expect(newer).toContainText("Other action · Book sql-internals");
    await expect(newer).toContainText("Action code: book.cover.changed");
    await expect(newer).toContainText("“New cover for the launch”");
    await expect(newer).toContainText("by Nick Lukashik");
    // No guessed name, and no before and after the console cannot read.
    await expect(newer).not.toContainText("book cover changed");
    await expect(newer.locator(".feed-change")).toHaveCount(0);
    // The actions the console knows keep their names.
    await expect(audit).toContainText("Content imported · Book sql-internals");
    await expect(audit).toContainText(
      "Access rule changed · Book nodejs-internals",
    );

    // The book's log and the platform's audit read on too.
    await visit(page, "/education/books/sql-internals");
    await expect(page.locator("#book-audit")).toContainText(
      "Action code: book.cover.changed",
    );
    await visit(page, "/audit?source=education");
    await expect(page.locator("#timeline")).toContainText(
      "Action code: book.cover.changed",
    );
    await expect(page.getByText(/Could not read/)).toHaveCount(0);
  });
});

test("support reads the books but cannot change them", async ({ page }) => {
  await signIn(page, "support", "/education/books/sql-internals");
  await expect(page.getByRole("heading", { name: "Chapters" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Readers of this book" }),
  ).toBeVisible();
  for (const name of ["Publish", "Back to draft", "Archive", "Change access"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
});

for (const persona of ["billing", "auditor"] as const) {
  test(`${persona} cannot open Education`, async ({ page }) => {
    await signIn(page, persona, "/education");
    await expect(page.getByText("Needs permission: edu.read")).toBeVisible();
    expect(await sidebarLinks(page)).not.toContain("Education");
    await visit(page, "/education/books/sql-internals");
    await expect(page.getByText("Needs permission: edu.read")).toBeVisible();
  });
}

test("an education editor runs the books and sees nothing else", async ({
  page,
}) => {
  await signIn(page, "editor", "/");
  expect(await sidebarLinks(page)).toEqual(["Dashboard", "Education"]);
  await expect(page.locator(".operator-roles")).toHaveText("Education editor");
  await expect(
    page.getByRole("region", { name: "Readers and books" }),
  ).toBeVisible();
  await visit(page, "/education/books/nodejs-internals");
  await expect(
    page.getByRole("button", { name: "Change access" }),
  ).toBeVisible();
  // Readers are short IDs, never names.
  await visit(page, "/education/readers");
  await expect(page.locator("#reader-filters")).toBeVisible();
  await expect(page.locator("table .row-link.mono").first()).toBeVisible();
  await expect(page.getByText("Mira Levina")).toHaveCount(0);
  await visit(page, "/users");
  await expect(page.getByText("Needs permission: users.read")).toBeVisible();
});

test("readers are filtered by book in the URL; a reader is a short ID that opens the user card", async ({
  page,
}) => {
  await signIn(page, "owner", "/users?query=mira");
  await page.getByRole("link", { name: "Mira Levina" }).click();
  await page.waitForURL(USER_CARD);
  const miraId = new URL(page.url()).pathname.split("/").pop() as string;

  await visit(page, "/education/readers");
  // Mira reads both books: two rows, each her short ID, as in the console's
  // other lists of users; her name stays on her card.
  const idLink = page.getByRole("link", {
    name: miraId.slice(0, 8),
    exact: true,
  });
  const mira = page.locator("table").locator(idLink);
  await expect(mira).toHaveCount(2);
  await expect(mira.first()).toHaveAttribute("href", `/users/${miraId}`);
  await expect(page.locator("table").getByText("Mira Levina")).toHaveCount(0);

  await page.getByLabel("Book").selectOption("sql-internals");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/\/education\/readers\?book=sql-internals/);
  await settle(page);
  await expect(mira).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "Node.js изнутри" })).toHaveCount(
    0,
  );

  // The book in her row opens the book…
  const row = page.locator("table tbody tr").filter({ has: idLink });
  await row.getByRole("link", { name: "SQL изнутри" }).click();
  await expect(page).toHaveURL("/education/books/sql-internals");
  await page.goBack();
  await settle(page);
  // …and the rest of the row her card, as in the console's other tables.
  const cell = await row.locator("td").last().boundingBox();
  if (!cell) throw new Error("Mira's row has no last cell");
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await expect(page).toHaveURL(`/users/${miraId}`);
  await settle(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Mira Levina" }),
  ).toBeVisible();
});

test.describe("reader lists", () => {
  // This run's own tag: the fake platform keeps the calls made under it.
  const tag = `readers-${Date.now().toString(36)}`;
  test.use({ userAgent: withFailure(`fake-trace=${tag}`) });

  test("ask Identity for no user per row, however many rows", async ({
    page,
  }) => {
    await signIn(page, "owner", "/education/readers");
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(10);
    await visit(page, "/education/readers?book=nodejs-internals");
    await expect(rows.first()).toBeVisible();
    await visit(page, "/education");
    await expect(
      page.getByRole("heading", { name: "Recently active readers" }),
    ).toBeVisible();
    await expect(rows.first()).toBeVisible();

    const calls = await tracedRequests(page, tag);
    // The lists were read…
    expect(calls).toContain("GET /edu/v1/admin/readers");
    // …and not one user record for their rows (Identity allows an operator
    // 120 requests a minute).
    expect(
      calls.filter((call) =>
        /^GET \/auth\/v1\/admin\/users\/[^/]+$/.test(call),
      ),
    ).toEqual([]);
  });
});

test("Education grants say whether they are in force, scheduled, expired or revoked", async ({
  page,
}) => {
  // Payments calls Artem's three grants active; only one opens books now.
  await signIn(page, "owner", "/users?query=artem.k");
  await page.getByRole("link", { name: "Artem Kuznetsov" }).click();
  await settle(page);
  await openUserTab(page, "Education");
  const grants = page.locator("#reader-grants");
  const state = (target: string) =>
    grants.locator("tbody tr").filter({ hasText: target }).locator(".status");
  await expect(state("edu:library")).toHaveText("In force");
  await expect(state("edu:book.sql-internals")).toHaveText("Scheduled");
  await expect(state("edu:book.nodejs-internals")).toHaveText("Expired");
  await expect(grants.getByText("Active", { exact: true })).toHaveCount(0);

  // A revoked grant stays revoked.
  await visit(page, "/users?query=ivan.sokolov");
  await page.getByRole("link", { name: "Ivan Sokolov" }).click();
  await settle(page);
  await openUserTab(page, "Education");
  await expect(state("edu:library")).toHaveText("Revoked");
});

test("Education grant states speak Russian", async ({ page, context }) => {
  await useRussian(context);
  await signIn(page, "owner", "/users?query=artem.k");
  await page.getByRole("link", { name: "Artem Kuznetsov" }).click();
  await page.waitForURL(USER_CARD);
  await visit(page, `${new URL(page.url()).pathname}?tab=education`);
  const grants = page.locator("#reader-grants");
  const state = (target: string) =>
    grants.locator("tbody tr").filter({ hasText: target }).locator(".status");
  await expect(state("edu:library")).toHaveText("Действует");
  await expect(state("edu:book.sql-internals")).toHaveText("Запланирован");
  await expect(state("edu:book.nodejs-internals")).toHaveText("Истёк");
});

test("a book is given by hand from the user card and Education sees it", async ({
  page,
}) => {
  await signIn(page, "owner", "/users?query=tom");
  await page.getByRole("link", { name: "Tom Becker" }).click();
  await settle(page);
  await openUserTab(page, "Education");
  await expect(page.getByText("Has not read anything yet")).toBeVisible();

  await openUserTab(page, "Product access");
  await page.getByRole("button", { name: "Give access" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Give access without a payment",
  });
  const feature = dialog.getByLabel("Feature");
  await expect(
    feature.locator("option", { hasText: "Education — every book" }),
  ).toHaveCount(1);
  await feature.selectOption("edu:book.sql-internals");
  await dialog.getByLabel("Reason").fill("Speaker at the SQL meetup");
  await dialog.getByRole("button", { name: "Give access" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Access granted."),
  ).toBeVisible();
  await expect(page.locator("#payments-grants")).toContainText(
    "book.sql-internals",
  );

  await openUserTab(page, "Education");
  const grants = page.locator("#reader-grants");
  await expect(grants).toContainText("SQL изнутри");
  await expect(grants).toContainText("edu:book.sql-internals");
  await expect(grants).toContainText("In force");
});

test.describe("the AI assistant on the overview", () => {
  test("shows the week's requests with their shares, tokens, the reader's limit and today's spending", async ({
    page,
  }) => {
    await signIn(page, "owner", "/education");
    const assist = page.getByRole("region", { name: "AI assistant" });
    await expect(assist.locator(".status")).toHaveText("On");
    await expect(assist).toContainText("Readers see it in open chapters.");
    await expect(stat(assist, "Requests").locator(".stat-value")).toHaveText(
      "1,284",
    );
    // Cached and failed: counts with their share of all requests.
    const cached = stat(assist, "From the cache");
    await expect(cached.locator(".stat-value")).toHaveText("321");
    await expect(cached.locator(".stat-hint")).toHaveText("25% of requests");
    const failed = stat(assist, "Failed");
    await expect(failed.locator(".stat-value")).toHaveText("13");
    await expect(failed.locator(".stat-hint")).toHaveText("1% of requests");
    await expect(stat(assist, "Tokens in").locator(".stat-value")).toHaveText(
      "2,486,910",
    );
    await expect(stat(assist, "Tokens out").locator(".stat-value")).toHaveText(
      "612,304",
    );
    await expect(assist).toContainText("30 requests per reader");
    await expect(assist).toContainText("Resets at 00:00 UTC.");
    // Today's model calls of all readers against the spending cap: far
    // from it, so nothing warns.
    const cap = fact(assist, "Spending cap");
    await expect(cap.locator(".fact-value")).toHaveText(
      "37 of 500 calls today",
    );
    await expect(cap).toContainText(
      "All readers together. Resets at 00:00 UTC.",
    );
    await expect(assist.locator('[data-tone="warn"]')).toHaveCount(0);
    // What counts: cached answers spend neither tokens nor either limit.
    await expect(assist).toContainText(
      "no tokens, and nothing taken from the reader's daily limit or the spending cap",
    );
    // It sits under the reading numbers, which it does not replace.
    await expect(
      page.getByRole("region", { name: "Readers and books" }),
    ).toContainText("Exercises solved");
  });

  test("speaks Russian with Russian numbers", async ({ page, context }) => {
    await useRussian(context);
    await signIn(page, "owner", "/education");
    const assist = page.getByRole("region", { name: "ИИ-помощник" });
    await expect(assist.locator(".status")).toHaveText("Включён");
    // Grouped with no-break spaces, as Intl writes Russian numbers.
    await expect(stat(assist, "Запросов").locator(".stat-value")).toHaveText(
      /^1\s284$/,
    );
    await expect(stat(assist, "Из кэша").locator(".stat-hint")).toHaveText(
      /^25\s%\sзапросов$/,
    );
    await expect(
      stat(assist, "Токенов на входе").locator(".stat-value"),
    ).toHaveText(/^2\s486\s910$/);
    await expect(assist).toContainText("30 запросов на читателя");
    const cap = fact(assist, "Общий лимит");
    await expect(cap.locator(".fact-value")).toHaveText(
      "37 из 500 запросов сегодня",
    );
    await expect(cap).toContainText(
      "На всех читателей вместе. Сбросится в 00:00 UTC.",
    );
  });

  test.describe("switched off", () => {
    test.use({ userAgent: withFailure("fake-assist=off") });

    test("says readers do not see it, with zeros and no shares", async ({
      page,
    }) => {
      await signIn(page, "owner", "/education");
      const assist = page.getByRole("region", { name: "AI assistant" });
      await expect(assist.locator(".status")).toHaveText("Off");
      await expect(assist).toContainText(
        "Hidden from readers: no model key, safe mode, or switched off in the settings.",
      );
      await expect(stat(assist, "Requests").locator(".stat-value")).toHaveText(
        "0",
      );
      // Nothing asked this week: no share of nothing, never NaN.
      await expect(assist.getByText(/of requests|NaN/)).toHaveCount(0);
      await expect(assist).toContainText("30 requests per reader");
      // A cap of 0 is no cap, never "0 of 0".
      const cap = fact(assist, "Spending cap");
      await expect(cap).toContainText("No spending cap");
      await expect(cap).toContainText(
        "Only each reader's daily limit applies.",
      );
      await expect(cap).not.toContainText(/\d/);
    });
  });

  test.describe("paused by the spending cap", () => {
    test.use({ userAgent: withFailure("fake-assist=paused") });

    test("warns that readers get no new answers until 00:00 UTC", async ({
      page,
    }) => {
      await signIn(page, "owner", "/education");
      const assist = page.getByRole("region", { name: "AI assistant" });
      const status = assist.locator(".status");
      await expect(status).toHaveText("Paused");
      await expect(status).toHaveAttribute("data-tone", "warn");
      await expect(fact(assist, "Status")).toContainText(
        "Paused for readers until 00:00 UTC: the spending cap is reached. Cached answers are still served.",
      );
      // The cap that paused it: used up, in the warning tone and with an
      // icon (never colour alone), numbers grouped.
      const used = fact(assist, "Spending cap").locator(".fact-value");
      await expect(used).toHaveText("1,000 of 1,000 calls today");
      await expect(used).toHaveAttribute("data-tone", "warn");
      await expect(used.locator("svg")).toHaveAttribute("aria-hidden", "true");
      // The week's numbers read on.
      await expect(stat(assist, "Requests").locator(".stat-value")).toHaveText(
        "2,487",
      );
    });

    test("says so in Russian, with Russian numbers", async ({
      page,
      context,
    }) => {
      await useRussian(context);
      await signIn(page, "owner", "/education");
      const assist = page.getByRole("region", { name: "ИИ-помощник" });
      await expect(assist.locator(".status")).toHaveText("Приостановлен");
      await expect(fact(assist, "Статус")).toContainText(
        "Приостановлен для читателей до 00:00 UTC: общий лимит исчерпан.",
      );
      await expect(
        fact(assist, "Общий лимит").locator(".fact-value"),
      ).toHaveText(/^1\s000 из 1\s000 запросов сегодня$/);
    });
  });

  test.describe("when Education answers with an error", () => {
    // Up, but its database is not: 503 with the error envelope.
    test.use({ userAgent: withFailure("fake-error=edu") });

    test("says so with a retry, never zeros", async ({ page }) => {
      await signIn(page, "owner", "/education");
      const assist = page.getByRole("region", { name: "AI assistant" });
      await expect(assist.getByRole("alert")).toContainText(
        "Could not load assistant numbers",
      );
      await expect(assist.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(assist.locator(".stat")).toHaveCount(0);
      // The reading numbers fail on their own, with their own retry.
      await expect(
        page
          .getByRole("region", { name: "Readers and books" })
          .getByRole("alert"),
      ).toContainText("Could not load reading numbers");
    });
  });

  test.describe("on the narrowest phone", () => {
    test.use({ ...phone, viewport: { width: 360, height: 780 } });

    test("keeps every number inside the card, without sideways scrolling", async ({
      page,
    }) => {
      await signIn(page, "owner", "/education");
      const assist = page.getByRole("region", { name: "AI assistant" });
      const card = await assist.boundingBox();
      if (!card) throw new Error("the assistant's card has no box");
      // Five numbers of the week and today's calls against the cap.
      const values = await assist.locator(".stat-value, .fact-value").all();
      expect(values).toHaveLength(6);
      for (const value of values) {
        const box = await value.boundingBox();
        if (!box) throw new Error("a number has no box");
        expect(box.x).toBeGreaterThanOrEqual(card.x);
        expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
      }
      await expectNoSideScroll(page);
    });
  });
});

test.describe("not connected", () => {
  test.use({ userAgent: withFailure("fake-down=edu") });

  test("reads as 'not connected yet', and grants offer no books", async ({
    page,
  }) => {
    await signIn(page, "owner", "/education");
    // One calm panel for the whole overview, not one per section.
    await expect(page.getByText("Education is not connected yet")).toHaveCount(
      1,
    );
    await expect(
      page.getByRole("button", { name: "Check again" }),
    ).toBeVisible();
    await expect(page.getByText(/Could not load/)).toHaveCount(0);

    await visit(page, "/");
    await expect(
      page.getByRole("region", { name: "Readers and books" }),
    ).toContainText("Education is not connected yet");

    await visit(page, "/payments/grants");
    await page.getByRole("button", { name: "Give access" }).click();
    const feature = page.getByRole("dialog").getByLabel("Feature");
    await expect(feature.locator("option")).not.toHaveCount(0);
    await expect(feature.locator("option", { hasText: "edu:" })).toHaveCount(0);
  });
});
