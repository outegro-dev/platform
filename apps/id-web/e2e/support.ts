import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

export const uniqueEmail = () =>
  `e2e-${randomBytes(6).toString("hex")}@outegro.test`;

/** Waits for the newest sign-in email to this address and returns its code. */
export async function codeFor(email: string, since: number) {
  const query = encodeURIComponent(`to:${email}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${query}&limit=1`,
    );
    const { messages } = (await response.json()) as {
      messages: { Subject: string; Created: string }[];
    };
    const latest = messages[0];
    const code = latest?.Subject.match(/\d{6}/)?.[0];
    if (code && Date.parse(latest.Created) >= since) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in email for ${email}`);
}

/** Signs in on the current /login page. */
export async function signIn(page: Page, email = uniqueEmail()) {
  const since = Date.now() - 1000;
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Six-digit code").fill(await codeFor(email, since));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return email;
}
