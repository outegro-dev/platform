import { readFileSync } from "node:fs";
import type { Http, HttpResponse } from "../http.js";

type Recorded = {
  status: number;
  url?: string;
  text: string;
  headers?: Record<string, string>;
};

/** Recorded public ATS responses (trimmed), by request URL. */
export function loadFixture(name: string): Record<string, Recorded> {
  return JSON.parse(
    readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"),
  );
}

/** A value in Nuxt's payload format (devalue): a flat array of entries pointing at each other. */
export function nuxtPayload(root: unknown): string {
  const out: unknown[] = [["ShallowReactive", 1]];
  const add = (value: unknown): number => {
    const index = out.length;
    out.push(null);
    if (Array.isArray(value)) out[index] = value.map(add);
    else if (value && typeof value === "object")
      out[index] = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, add(item)]),
      );
    else out[index] = value;
    return index;
  };
  add(root);
  return `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(out)}</script>`;
}

/**
 * An Http that answers from fixtures and inline pages; anything else is a
 * 404, so a test also proves which requests an adapter makes.
 */
export function fixtureHttp(
  names: string[],
  pages: Record<string, Recorded | string> = {},
): Http & { requests: string[] } {
  const table: Record<string, Recorded> = {};
  for (const name of names) Object.assign(table, loadFixture(name));
  for (const [url, page] of Object.entries(pages))
    table[url] = typeof page === "string" ? { status: 200, text: page } : page;
  const requests: string[] = [];
  return {
    requests,
    async get(url): Promise<HttpResponse> {
      requests.push(url);
      const hit = table[url];
      if (!hit) return { status: 404, url, headers: {}, text: "" };
      return {
        status: hit.status,
        url: hit.url ?? url,
        headers: hit.headers ?? {},
        text: hit.text,
      };
    },
  };
}
