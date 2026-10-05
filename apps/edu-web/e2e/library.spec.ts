import { expect, signIn, test } from "./support/fixtures.ts";

test.describe("library", () => {
  test("signed out: both books, what is inside and a way in", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Interactive textbooks",
    );
    const node = page.getByTestId("book-nodejs-internals");
    const sql = page.getByTestId("book-sql-internals");
    await expect(node.getByRole("heading", { level: 2 })).toHaveText(
      "Node.js изнутри",
    );
    await expect(sql.getByRole("heading", { level: 2 })).toHaveText(
      "SQL изнутри",
    );
    await expect(node).toContainText("13 chapters");
    await expect(node).toContainText("76 exercises");
    await expect(node).toContainText("122 flash cards");
    await expect(sql).toContainText("120 exercises");
    await expect(node.getByTestId("access-badge")).toHaveText(
      "Access: Sign in to read",
    );
    await expect(node.getByTestId("book-cta")).toHaveAttribute(
      "href",
      "/auth/sign-in?returnTo=%2Fbooks%2Fnodejs-internals",
    );
    await expect(node.getByTestId("book-progress")).toHaveCount(0);
    // The cover is the book's own illustration, described for screen readers
    // in the book's language (the page around it is English).
    await expect(
      node.getByRole("img", { name: /^Кольцо фаз event loop/ }),
    ).toBeVisible();
    await expect(node.locator(".book-card-cover")).toHaveAttribute(
      "lang",
      "ru",
    );
    await page.goto("/books/nodejs-internals");
    await expect(page.locator(".book-hero-cover")).toHaveAttribute(
      "lang",
      "ru",
    );
  });

  test("a reader without a grant: preview access, progress, start reading", async ({
    page,
  }) => {
    await signIn(page, "reader", "/");
    const node = page.getByTestId("book-nodejs-internals");
    await expect(node.getByTestId("access-badge")).toHaveText(
      "Access: Preview",
    );
    await expect(node.getByTestId("book-cta")).toHaveText("Start reading");
    await expect(node.getByTestId("book-cta")).toHaveAttribute(
      "href",
      "/books/nodejs-internals/1",
    );
    await expect(node.getByTestId("book-progress")).toContainText(
      "Exercises solved: 0 of 76",
    );
  });

  test("a subscriber has access, staff a preview of everything", async ({
    page,
    browser,
  }) => {
    await signIn(page, "subscriber", "/");
    await expect(
      page.getByTestId("book-sql-internals").getByTestId("access-badge"),
    ).toHaveText("Access: Your access");

    const staff = await browser.newPage();
    await signIn(staff, "staff", "/");
    await expect(
      staff.getByTestId("book-nodejs-internals").getByTestId("access-badge"),
    ).toHaveText("Access: Staff preview");
    await staff.close();
  });

  test("the book page: contents with locks, the preface and the deck", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /SQL\s+изнутри/,
    );
    const contents = page.locator(".contents-list");
    await expect(contents.getByRole("link")).toHaveCount(15);
    await expect(
      contents.getByRole("link", { name: /Учебная база/ }),
    ).toHaveAttribute("href", "/books/sql-internals/intro");
    await expect(
      contents.getByRole("link", { name: /Карточки по всей книге/ }),
    ).toHaveAttribute("href", "/books/sql-internals/cards");
    // Chapter 1 is the preview; chapter 2 on is locked for this reader.
    await expect(
      contents.getByRole("link", { name: /Реляционная модель/ }),
    ).toContainText("Preview");
    await expect(
      contents.getByRole("link", { name: /SELECT: в каком порядке/ }),
    ).toContainText("locked");
    // No product in the catalog: access is by invitation, through the contact form.
    const offer = page.getByTestId("access-offer");
    await expect(offer).toHaveAttribute("data-offer", "invitation");
    await expect(offer).toHaveAttribute("href", /\/site\/#contact$/);
  });

  test("an unknown book or chapter answers 404, and is never indexed", async ({
    page,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/status of 404/);
    // The book (and the chapter number) is checked in a layout above the
    // loading skeleton, before anything streams: a real status.
    for (const path of [
      "/books/no-such-book",
      "/books/no-such-book/1",
      "/books/no-such-book/cards",
      "/books/nodejs-internals/99",
      "/books/nodejs-internals/0",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Page not found",
      );
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        "content",
        /noindex/,
      );
    }
    // A book that is there still answers 200 behind its skeleton.
    expect((await page.goto("/books/nodejs-internals"))?.status()).toBe(200);
  });
});
