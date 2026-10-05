import { blocksOf } from "./support/books.ts";
import {
  assistLog,
  engineLoadsOffline,
  expect,
  HUGE_RESULT,
  hydrated,
  recordedAttempts,
  signIn,
  test,
} from "./support/fixtures.ts";

const firstTask = blocksOf("sql-internals", 1, "sqlTask")[0];

test.describe("SQL book", () => {
  test("a sandbox runs on the training database (SQLite in a worker)", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals/1");
    const sandbox = page.locator(".sandbox").first();
    await expect(sandbox).toContainText("Песочница");
    // Near the screen it runs by itself, as the book's pages did.
    const table = sandbox.locator(".sql-table");
    await expect(table).toBeVisible({ timeout: 30_000 });
    // The last statement's result: the customers.
    await expect(table.locator("thead th")).toHaveText([
      "id",
      "name",
      "email",
      "city",
      "created_at",
    ]);
    await expect(table.locator("tbody tr")).toHaveCount(10);
    await expect(sandbox.locator(".sql-count")).toHaveText("10 строк");
    await expect(table.locator("td[data-kind='null']")).toHaveText(["NULL"]);
    await expect(table.locator("td[data-kind='number']").first()).toHaveText(
      "1",
    );
  });

  test("the editor: Ctrl+Enter runs, Tab indents, errors are explained", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals/1");
    const sandbox = page.locator(".sandbox").first();
    const editor = sandbox.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await editor.fill("SELECT");
    await editor.press("Tab");
    await expect(editor).toHaveValue("SELECT  ");
    await editor.fill("SELECT 2 + 2 AS four, 7 / 2.0 AS half, NULL AS empty;");
    await editor.press("Control+Enter");
    const table = sandbox.locator(".sql-table");
    await expect(table.locator("tbody td")).toHaveText(["4", "3.5", "NULL"], {
      timeout: 30_000,
    });
    await editor.fill("SELECT * FROM no_such_table;");
    await editor.press("Control+Enter");
    await expect(sandbox.getByRole("alert")).toHaveText(
      "Ошибка SQLite: no such table: no_such_table",
    );
  });

  test("an endless query is stopped after 3 seconds, and the next one runs", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals/1");
    const sandbox = page.locator(".sandbox").first();
    const editor = sandbox.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await editor.fill(
      "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t) SELECT count(*) FROM t;",
    );
    const started = Date.now();
    await sandbox.getByRole("button", { name: "Выполнить" }).click();
    await expect(sandbox.getByRole("alert")).toContainText("дольше 3 секунд", {
      timeout: 30_000,
    });
    expect(Date.now() - started).toBeGreaterThan(2_900);
    await sandbox.getByRole("button", { name: "Вернуть исходный" }).click();
    await expect(sandbox.locator(".sql-count")).toHaveText("10 строк", {
      timeout: 30_000,
    });
  });

  test("Restore the original waits for the reader's own run, from the keyboard too", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals/1");
    const sandbox = page.locator(".sandbox").first();
    const editor = sandbox.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await expect(sandbox.locator(".sql-count")).toHaveText("10 строк", {
      timeout: 30_000,
    });
    const original = await editor.inputValue();
    const endless =
      "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t) SELECT count(*) FROM t;";
    await editor.fill(endless);
    await sandbox.getByRole("button", { name: "Выполнить" }).click();
    const reset = sandbox.getByRole("button", { name: "Вернуть исходный" });
    await expect(reset).toHaveAttribute("aria-disabled", "true");
    await reset.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(editor).toHaveValue(endless);
    // Once the run is stopped, it restores and runs the book's query.
    await expect(sandbox.getByRole("alert")).toContainText("дольше 3 секунд", {
      timeout: 30_000,
    });
    await expect(reset).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveValue(original);
    await expect(sandbox.locator(".sql-count")).toHaveText("10 строк", {
      timeout: 30_000,
    });
  });

  test("offline, a sandbox says the engine will load with the connection, and does", async ({
    page,
    context,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/ERR_INTERNET_DISCONNECTED|Failed to fetch/);
    await signIn(page, "reader", "/");
    const engine = await engineLoadsOffline(context);
    await page.goto("/books/sql-internals/1");
    const sandbox = page.locator(".sandbox").first();
    // The first run started by itself and waits for the engine.
    await expect(sandbox.locator(".sql-message")).toHaveText("Выполняю…");
    await engine.offline();
    const offline = sandbox.locator(".sql-offline");
    await expect(offline).toContainText(
      "Нет сети: песочница загрузится, когда связь вернётся.",
      { timeout: 30_000 },
    );
    await expect(offline).not.toContainText("Обновите страницу");
    await expect(
      offline.getByRole("button", { name: "Повторить" }),
    ).toBeVisible();
    await engine.online();
    await expect(sandbox.locator(".sql-count")).toHaveText("10 строк", {
      timeout: 30_000,
    });
    await expect(offline).toHaveCount(0);
  });

  test("offline, a task's check waits: Retry tries again, and the connection back checks it", async ({
    page,
    context,
    allowConsoleErrors,
  }) => {
    if (!firstTask) throw new Error("no task in chapter 1");
    allowConsoleErrors(/ERR_INTERNET_DISCONNECTED|Failed to fetch/);
    await signIn(page, "reader", "/");
    const engine = await engineLoadsOffline(context);
    await page.goto("/books/sql-internals/1");
    const task = page.locator(".sql-task").first();
    const editor = task.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await editor.fill(firstTask.solution);
    await task.getByRole("button", { name: "Проверить" }).click();
    await engine.offline();
    const offline = task.locator(".sql-offline");
    await expect(offline).toContainText(
      "Нет сети: песочница загрузится, когда связь вернётся.",
      { timeout: 30_000 },
    );
    await expect(offline.getByRole("alert")).toBeVisible();
    // Still offline: Retry tries again and says the same.
    await offline.getByRole("button", { name: "Повторить" }).click();
    await expect(offline).toContainText("Нет сети", { timeout: 30_000 });
    expect((await recordedAttempts(page, firstTask.id)).requests).toBe(0);
    await engine.online();
    await expect(task.locator(".ex-result")).toHaveText(
      "Верно. Результат совпал с эталоном.",
      { timeout: 30_000 },
    );
    await expect(task.getByTestId("save-status")).toHaveText(
      "Сохранено в аккаунте",
    );
  });

  test("a result too large to send is checked here and said not saved, with no Retry", async ({
    page,
  }) => {
    if (!firstTask) throw new Error("no task in chapter 1");
    await signIn(page, "reader", "/books/sql-internals/1");
    const task = page.locator(".sql-task").first();
    const editor = task.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await editor.fill(HUGE_RESULT);
    await task.getByRole("button", { name: "Проверить" }).click();
    await expect(task.getByTestId("save-status")).toHaveText(
      "Не сохранено: результат слишком большой для отправки. Сузьте запрос.",
      { timeout: 30_000 },
    );
    await expect(task.locator(".ex-result")).toContainText(
      "Пока не совпадает.",
    );
    await expect(task.getByRole("button", { name: "Повторить" })).toHaveCount(
      0,
    );
    expect((await recordedAttempts(page, firstTask.id)).requests).toBe(0);
    // The hint sends only the start of such a result, well within a body.
    await task.getByRole("button", { name: "Спросить, что не так" }).click();
    await expect(task.getByTestId("sql-hint-answer")).toContainText(
      "customers",
    );
    const asked = (await assistLog(page)).requests.at(-1)?.body as {
      mine?: { rows: string[][]; rowCount: number };
    };
    expect(asked.mine?.rowCount).toBe(200);
    expect(asked.mine?.rows.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(asked.mine).length).toBeLessThanOrEqual(16 * 1024);
  });

  test("a task passes with its solution and stays solved", async ({ page }) => {
    if (!firstTask) throw new Error("no task in chapter 1");
    await signIn(page, "reader", "/books/sql-internals/1");
    const task = page.locator(".sql-task").first();
    await expect(task.locator(".ex-label")).toContainText("Задача · SQL");
    const editor = task.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await expect(editor).toHaveValue("SELECT ");

    // A wrong shape is explained.
    await editor.fill("SELECT id FROM products;");
    await task.getByRole("button", { name: "Проверить" }).click();
    await expect(task.locator(".ex-result")).toHaveText(
      "Пока не совпадает. Колонок у вас 1, а нужно 3.",
      { timeout: 30_000 },
    );
    // Nothing returned: said as it is, without "not yet" in front.
    await editor.fill("CREATE TABLE notes (id INTEGER);");
    await task.getByRole("button", { name: "Проверить" }).click();
    await expect(task.locator(".ex-result")).toHaveText(
      "Запрос ничего не вернул. В конце должен быть SELECT.",
    );
    // The editor grows with the query (5 rows at first, 16 at most).
    await expect(editor).toHaveAttribute("rows", "5");
    await editor.fill(
      Array.from({ length: 9 }, (_, i) => `-- line ${i + 1}`).join("\n"),
    );
    await expect(editor).toHaveAttribute("rows", "10");
    await editor.fill(Array.from({ length: 30 }, () => "--").join("\n"));
    await expect(editor).toHaveAttribute("rows", "16");

    if (firstTask.hint) {
      await task.getByRole("button", { name: "Подсказка" }).click();
      await expect(task.locator(".task-hint")).toBeVisible();
    }
    await task.getByRole("button", { name: "Показать решение" }).click();
    await expect(task.locator(".task-solution")).toContainText(
      "Эталонное решение",
    );
    await task.getByRole("button", { name: "Вставить в редактор" }).click();
    await expect(editor).toHaveValue(firstTask.solution);
    await expect(editor).toBeFocused();
    await task.getByRole("button", { name: "Проверить" }).click();
    await expect(task.locator(".ex-result")).toHaveText(
      "Верно. Результат совпал с эталоном.",
      { timeout: 30_000 },
    );
    await expect(task.locator(".ex-solved")).toHaveText("решено");
    await expect(task.getByTestId("save-status")).toHaveText(
      "Сохранено в аккаунте",
    );

    // After a reload: still solved, and the draft is still in the editor.
    await page.reload();
    const again = page.locator(".sql-task").first();
    await expect(again.locator(".ex-solved")).toHaveText("решено");
    await expect(
      again.getByRole("textbox", { name: "SQL-запрос" }),
    ).toHaveValue(firstTask.solution);
  });

  test("the preface lists the training tables from the seed", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals/intro");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Учебная база",
    );
    const tables = page.locator(".schema-table");
    await expect(tables).toHaveCount(7);
    await expect(tables.filter({ hasText: "customers" })).toContainText(
      "10 строк",
    );
    await expect(tables.filter({ hasText: "orders" }).first()).toContainText(
      "18 строк",
    );
    await expect(tables.filter({ hasText: "order_items" })).toContainText(
      "order_idinteger · PK",
    );
  });
});
