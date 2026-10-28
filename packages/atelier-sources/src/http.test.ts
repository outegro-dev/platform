import { describe, expect, it } from "vitest";
import { htmlToText } from "./html.js";
import {
  createHostLimiter,
  createHttp,
  defaultUserAgent,
  HttpRequestError,
} from "./http.js";
import { toIsoUtc, toSalary } from "./normalize.js";

describe("createHttp", () => {
  it("sends the bot user agent and the accept header, returns status, final url and headers", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const http = createHttp({
      perHostIntervalMs: 0,
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, headers: init.headers as Record<string, string> });
        return new Response('{"ok":true}', {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });
    const response = await http.get("https://api.lever.co/v0/postings/x", {
      accept: "json",
      headers: { "X-Test": "1" },
    });
    expect(response).toMatchObject({
      status: 201,
      text: '{"ok":true}',
      headers: { "content-type": "application/json" },
    });
    expect(seen[0]?.headers).toMatchObject({
      "user-agent": defaultUserAgent,
      accept: "application/json",
      "x-test": "1",
    });
  });

  it("spaces requests to one host, not across hosts", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limit = createHostLimiter(
      1000,
      () => clock,
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    );
    await limit("a.com");
    await limit("a.com");
    await limit("b.com");
    await limit("a.com");
    expect(waits).toEqual([1000, 1000]);
  });

  it("turns network failures and timeouts into HttpRequestError", async () => {
    const failing = createHttp({
      perHostIntervalMs: 0,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(failing.get("https://x.com/")).rejects.toBeInstanceOf(
      HttpRequestError,
    );
    const slow = createHttp({
      perHostIntervalMs: 0,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        })) as typeof fetch,
    });
    await expect(
      slow.get("https://x.com/", { timeoutMs: 20 }),
    ).rejects.toMatchObject({ timedOut: true });
    await expect(failing.get("file:///etc/passwd")).rejects.toThrow(
      /Unsupported protocol/,
    );
  });
});

describe("text and values", () => {
  it("htmlToText: paragraphs, headings, bullets, escaped HTML", () => {
    const html =
      "<h2>About</h2><p>We&nbsp;build <b>tools</b>.</p><ul><li><p>First</p></li><li>Second<ul><li>Nested</li></ul></li></ul><p>Line<br>break</p><script>x()</script>";
    expect(htmlToText(html)).toBe(
      "About\n\nWe build tools.\n\n- First\n- Second\n- Nested\n\nLine\nbreak",
    );
    expect(
      htmlToText(
        "&lt;p&gt;Escaped&lt;/p&gt;&lt;ul&gt;&lt;li&gt;item&lt;/li&gt;&lt;/ul&gt;",
      ),
    ).toBe("Escaped\n\n- item");
    expect(htmlToText("<p>• Glyph bullet</p><p>* star bullet</p>")).toBe(
      "- Glyph bullet\n- star bullet",
    );
  });

  it("toIsoUtc: the contract's offset-free form", () => {
    expect(toIsoUtc(1791447663496)).toBe("2026-10-08T08:21:03.496Z");
    expect(toIsoUtc("2026-10-27T12:21:02-04:00")).toBe(
      "2026-10-27T16:21:02.000Z",
    );
    expect(toIsoUtc("2026-10-28T00:54:53.000000Z")).toBe(
      "2026-10-28T00:54:53.000Z",
    );
    expect(toIsoUtc("2026-10-27")).toBe("2026-10-27T00:00:00.000Z");
    expect(toIsoUtc("Posted Today")).toBeNull();
    expect(toIsoUtc(null)).toBeNull();
  });

  it("toSalary: periods and empty amounts", () => {
    expect(toSalary(100, 200, "usd", "per-year-salary")).toEqual({
      min: 100,
      max: 200,
      currency: "USD",
      period: "year",
    });
    expect(toSalary(30, null, "EUR", "1 HOUR")).toEqual({
      min: 30,
      max: null,
      currency: "EUR",
      period: "hour",
    });
    expect(toSalary(null, null, "USD", "year")).toBeNull();
    expect(toSalary(1, 2, "", "year")).toBeNull();
    expect(toSalary(1, 2, "USD", "weird")).toBeNull();
  });
});
