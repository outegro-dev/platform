import { describe, expect, it } from "vitest";
import { fixtureHttp } from "./__fixtures__/fixture-http.js";
import {
  companySlugVariants,
  discoverAggregator,
  discoverBoards,
  listBoard,
} from "./boards.js";
import type { Http } from "./http.js";
import { SourceError } from "./types.js";

describe("listBoard", () => {
  it("Lever", async () => {
    const http = fixtureHttp(["lever-list"]);
    // The fixture was recorded with ?limit=3; listBoard asks for the whole board.
    const table = Object.values(
      (await import("./__fixtures__/fixture-http.js")).loadFixture(
        "lever-list",
      ),
    )[0];
    const list = await listBoard("lever", "zartis", {
      get: async (url) => ({
        ...(await http.get(url)),
        status: 200,
        text: table?.text ?? "[]",
      }),
    });
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      ats: "lever",
      board: "zartis",
      jobId: "d47ed113-862f-4581-9968-5539b47a7a4e",
      url: "https://jobs.lever.co/zartis/d47ed113-862f-4581-9968-5539b47a7a4e",
      title: "Agentic Product Engineers",
      updatedAt: "2026-10-08T08:21:03.496Z",
    });
  });

  it("Lever: a board missing on the US host is read from the EU host", async () => {
    const requests: string[] = [];
    const http: Http = {
      async get(url) {
        requests.push(url);
        const eu = url.startsWith("https://api.eu.lever.co/");
        return {
          status: eu ? 200 : 404,
          url,
          headers: {},
          text: eu ? "[]" : '{"ok":false}',
        };
      },
    };
    expect(await listBoard("lever", "coinspaid", http)).toEqual([]);
    expect(requests).toEqual([
      "https://api.lever.co/v0/postings/coinspaid?mode=json",
      "https://api.eu.lever.co/v0/postings/coinspaid?mode=json",
    ]);
  });

  it("Greenhouse (an EU board through the same API)", async () => {
    const list = await listBoard(
      "greenhouse",
      "dwelly",
      fixtureHttp(["greenhouse-eu-list"]),
    );
    expect(list).toHaveLength(3);
    expect(list[0]?.url).toMatch(
      /^https:\/\/job-boards\.eu\.greenhouse\.io\/dwelly\/jobs\/\d+$/,
    );
    expect(list[0]?.updatedAt).toMatch(/Z$/);
  });

  it("Workable: one posting per shortcode, locations joined", async () => {
    const list = await listBoard(
      "workable",
      "soda-data-nv",
      fixtureHttp(["workable-widget"]),
    );
    expect(list.map((item) => item.jobId)).toEqual([
      "C0FCA11DED",
      "F4000FDBCE",
    ]);
    expect(list[0]).toMatchObject({
      url: "https://apply.workable.com/soda-data-nv/j/C0FCA11DED/",
      remote: true,
      location:
        "New York, New York, United States; San Francisco, California, United States",
    });
  });

  it("SmartRecruiters", async () => {
    const list = await listBoard(
      "smartrecruiters",
      "ScalableGmbH",
      fixtureHttp(["smartrecruiters-list"]),
    );
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      url: "https://jobs.smartrecruiters.com/ScalableGmbH/744000158036092",
      remote: false,
      department: "Finance",
    });
  });

  it("Ashby", async () => {
    const recorded = Object.values(
      (await import("./__fixtures__/fixture-http.js")).loadFixture(
        "ashby-board",
      ),
    )[0];
    const list = await listBoard("ashby", "ramp", {
      get: async (url) => ({
        status: 200,
        url,
        headers: {},
        text: recorded?.text ?? "",
      }),
    });
    expect(list[0]).toMatchObject({
      ats: "ashby",
      board: "ramp",
      title: "Security Engineer, Cloud",
      remote: true,
    });
  });

  it("a missing board is a not_found SourceError", async () => {
    await expect(
      listBoard("greenhouse", "nope", fixtureHttp([])),
    ).rejects.toMatchObject({ status: "not_found" });
  });
});

describe("discoverBoards", () => {
  it("slug variants without legal and descriptive suffixes", () => {
    expect(companySlugVariants("Acme Labs, Inc.")).toEqual([
      "acmelabs",
      "acme-labs",
      "acme",
      "acmelabsinc",
    ]);
    expect(companySlugVariants("Soda Data NV")).toEqual([
      "sodadata",
      "soda-data",
      "sodadatanv",
    ]);
    expect(companySlugVariants("Trading 212")).toEqual([
      "trading212",
      "trading-212",
    ]);
    expect(companySlugVariants("Linear")).toEqual(["linear"]);
  });

  it("probes every ATS and keeps boards with postings", async () => {
    const requests: string[] = [];
    const http: Http = {
      async get(url) {
        requests.push(url);
        if (url === "https://api.ashbyhq.com/posting-api/job-board/acme")
          return {
            status: 200,
            url,
            headers: {},
            text: '{"jobs":[{"id":"1"},{"id":"2"}]}',
          };
        if (url.startsWith("https://api.smartrecruiters.com/"))
          return {
            status: 200,
            url,
            headers: {},
            text: '{"totalFound":0,"content":[]}',
          };
        if (
          url.startsWith(
            "https://boards-api.greenhouse.io/v1/boards/acme-labs/",
          )
        )
          return { status: 200, url, headers: {}, text: '{"jobs":[{"id":1}]}' };
        return { status: 404, url, headers: {}, text: "" };
      },
    };
    const found = await discoverBoards("Acme Labs", http);
    expect(found).toEqual([
      { ats: "greenhouse", board: "acme-labs", count: 1 },
      { ats: "ashby", board: "acme", count: 2 },
    ]);
    expect(
      requests.some((url) => url.startsWith("https://api.eu.lever.co/")),
    ).toBe(true);
  });
});

describe("discoverAggregator", () => {
  it("hirify: cards from the Nuxt payload with the original ATS link", async () => {
    const http = fixtureHttp(["hirify-home"]);
    const list = await discoverAggregator(
      "hirify",
      { pages: 1, intervalMs: 0 },
      http,
    );
    expect(http.requests).toEqual(["https://hirify.me/frontend-dev-jobs"]);
    expect(list).toHaveLength(3);
    const ashby = list.find((item) => item.originalUrl?.includes("ashbyhq"));
    expect(ashby).toMatchObject({
      url: expect.stringMatching(/^https:\/\/hirify\.me\/jobs\/1328338-/),
      company: "",
    });
    expect(list.find((item) => item.company === "FastPari")?.postedAt).toMatch(
      /Z$/,
    );
    const filtered = await discoverAggregator(
      "hirify",
      { pages: 1, intervalMs: 0, query: "frontend" },
      http,
    );
    expect(filtered.map((item) => item.title)).toEqual([
      "Staff Frontend Software Engineer (Management Solution)",
    ]);
  });

  it("hirify reads categories in order, one request per page, paced", async () => {
    const requests: number[] = [];
    const http: Http = {
      async get(url) {
        requests.push(Date.now());
        return {
          status: 200,
          url,
          headers: {},
          text: "<html><body></body></html>",
        };
      },
    };
    await discoverAggregator("hirify", { pages: 2, intervalMs: 30 }, http);
    expect(requests).toHaveLength(2);
    expect((requests[1] ?? 0) - (requests[0] ?? 0)).toBeGreaterThanOrEqual(25);
  });

  it("wantapply: the Cloudflare challenge is a browser SourceError", async () => {
    const challenge = Object.values(
      (await import("./__fixtures__/fixture-http.js")).loadFixture(
        "wantapply-challenge",
      ),
    )[0];
    const http: Http = {
      get: async (url) => ({
        status: 403,
        url,
        headers: {},
        text: challenge?.text ?? "",
      }),
    };
    const error = await discoverAggregator(
      "wantapply",
      { pages: 1 },
      http,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ status: "browser" });
  });

  it("wantapply: cards are /<role>-at-<company> links (rendered page)", async () => {
    const html = `<html><body>
      <article><a href="/frontend-engineer-at-loora?from=category"><h3>Frontend Engineer</h3></a><time datetime="2026-10-27T10:00:00Z">1 day ago</time></article>
      <article><a href="https://wantapply.com/ai-engineer-at-field-materials">AI Engineer</a></article>
      <a href="/about">About</a></body></html>`;
    const http: Http = {
      get: async (url) => ({ status: 200, url, headers: {}, text: html }),
    };
    const list = await discoverAggregator("wantapply", { pages: 1 }, http);
    expect(list).toEqual([
      {
        url: "https://wantapply.com/frontend-engineer-at-loora",
        title: "Frontend Engineer",
        company: "Loora",
        postedAt: "2026-10-27T10:00:00.000Z",
        originalUrl: null,
      },
      {
        url: "https://wantapply.com/ai-engineer-at-field-materials",
        title: "AI Engineer",
        company: "Field Materials",
        postedAt: null,
        originalUrl: null,
      },
    ]);
  });
});
