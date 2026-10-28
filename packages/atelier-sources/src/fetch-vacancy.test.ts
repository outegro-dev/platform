import { vacancyFieldsSchema } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { fixtureHttp, nuxtPayload } from "./__fixtures__/fixture-http.js";
import { fetchVacancy } from "./fetch-vacancy.js";
import type { Http } from "./http.js";
import { extractVacancyFromHtml } from "./page.js";
import type { FetchResult } from "./types.js";

function fields(result: FetchResult) {
  if (!result.ok)
    throw new Error(`expected ok, got ${result.status}: ${result.reason}`);
  expect(vacancyFieldsSchema.safeParse(result.fields).success).toBe(true);
  expect(result.fields.postedAt ?? "").toMatch(
    /^$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  return result.fields;
}

const longBody = (topic: string) =>
  `<p>We are looking for an engineer to build ${topic}. You will design APIs and work with the product team every day.</p>
   <h3>Requirements</h3><ul><li>5+ years of experience with TypeScript and Node.js</li><li>Experience with PostgreSQL and Redis</li><li>Fluent English</li></ul>
   <h3>Responsibilities</h3><ul><li><p>Own services end to end</p></li><li>Review code and mentor</li></ul>`;

describe("ATS adapters on recorded public postings", () => {
  it("Lever: API posting with sections, apply link and posted date", async () => {
    const http = fixtureHttp(["lever-posting"]);
    const result = await fetchVacancy(
      "https://jobs.lever.co/zartis/d47ed113-862f-4581-9968-5539b47a7a4e?lever-source=LinkedIn",
      http,
    );
    const f = fields(result);
    expect(result.ok && result.tier).toBe("api");
    expect(f).toMatchObject({
      provider: "lever",
      ats: "lever",
      atsBoard: "zartis",
      atsJobId: "d47ed113-862f-4581-9968-5539b47a7a4e",
      title: "Agentic Product Engineers",
      applyUrl:
        "https://jobs.lever.co/zartis/d47ed113-862f-4581-9968-5539b47a7a4e/apply",
      postedAt: "2026-10-08T08:21:03.496Z",
      originalUrl: null,
    });
    expect(f.text).toMatch(/\n- /);
    expect(http.requests).toEqual([
      "https://api.lever.co/v0/postings/zartis/d47ed113-862f-4581-9968-5539b47a7a4e",
    ]);
  });

  it("Lever EU: jobs.eu.lever.co goes to api.eu.lever.co; /apply is dropped", async () => {
    const http = fixtureHttp(["lever-eu-posting"]);
    const f = fields(
      await fetchVacancy(
        "https://jobs.eu.lever.co/coinspaid/21f0e26e-6ef9-41d6-ab85-f6dc7b869dc9/apply",
        http,
      ),
    );
    expect(http.requests[0]).toBe(
      "https://api.eu.lever.co/v0/postings/coinspaid/21f0e26e-6ef9-41d6-ab85-f6dc7b869dc9",
    );
    expect(f.url).toBe(
      "https://jobs.eu.lever.co/coinspaid/21f0e26e-6ef9-41d6-ab85-f6dc7b869dc9",
    );
    expect(f.location).toBe("Remote - European Region");
    // workplaceType says "hybrid", the location says remote.
    expect(f.remote).toBe(true);
  });

  it("Lever: a posting gone from the API and the page is closed", async () => {
    const http = fixtureHttp(["lever-closed"]);
    const result = await fetchVacancy(
      "https://jobs.lever.co/swingdev/94ec789f-dd5a-433e-b6ee-45b5a3054bd9/thanks",
      http,
    );
    expect(result).toMatchObject({ ok: false, status: "closed" });
  });

  it("Greenhouse: board API with company, location and #app form link", async () => {
    const http = fixtureHttp(["greenhouse-job"]);
    const f = fields(
      await fetchVacancy(
        "https://job-boards.greenhouse.io/twilio/jobs/7996774?gh_src=abc",
        http,
      ),
    );
    expect(f).toMatchObject({
      provider: "greenhouse",
      company: "Twilio",
      title: "Machine Learning Engineer",
      location: "Remote - Spain",
      remote: true,
      atsBoard: "twilio",
      atsJobId: "7996774",
      applyUrl: "https://job-boards.greenhouse.io/twilio/jobs/7996774#app",
    });
  });

  it("Greenhouse EU: job-boards.eu.greenhouse.io keeps its EU links", async () => {
    const http = fixtureHttp(["greenhouse-eu-job"]);
    const f = fields(
      await fetchVacancy(
        "https://job-boards.eu.greenhouse.io/dwelly/jobs/4954106101#app",
        http,
      ),
    );
    expect(f.url).toBe(
      "https://job-boards.eu.greenhouse.io/dwelly/jobs/4954106101",
    );
    expect(f.applyUrl).toBe(
      "https://job-boards.eu.greenhouse.io/dwelly/jobs/4954106101#app",
    );
    expect(f.company).toBe("Dwelly");
  });

  it("Greenhouse on a company page: gh_jid and the embedded board token", async () => {
    const page = `<html><body><h1>Careers</h1><script src="https://boards.greenhouse.io/embed/job_board/js?for=twilio"></script></body></html>`;
    const http = fixtureHttp(["greenhouse-job"], {
      "https://www.twilio.com/careers/job?gh_jid=7996774": page,
    });
    const result = await fetchVacancy(
      "https://www.twilio.com/careers/job?gh_jid=7996774",
      http,
    );
    const f = fields(result);
    expect(result.ok && result.source).toBe("greenhouse-api(gh_jid)");
    expect(f.url).toBe("https://www.twilio.com/careers/job?gh_jid=7996774");
    expect(f.atsBoard).toBe("twilio");
  });

  it("Ashby: posting-api board with compensation becomes a salary", async () => {
    const http = fixtureHttp(["ashby-board"]);
    const f = fields(
      await fetchVacancy(
        "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
        http,
      ),
    );
    expect(f).toMatchObject({
      provider: "ashby",
      title: "Security Engineer, Cloud",
      salary: { min: 211400, max: 290600, currency: "USD", period: "year" },
      applyUrl:
        "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
      // Hybrid in New York, remote in the US and Canada (secondary locations).
      remote: true,
    });
    expect(f.location).toBe(
      "New York, NY (HQ); Remote (Canada); Remote (US); Miami, FL",
    );
    expect(f.text).toContain("$211.4K");
  });

  it("Ashby: a job missing from the board is read from the page's app data, else closed", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const posting = {
      title: "Unlisted Frontend Engineer",
      descriptionHtml: longBody("an unlisted product"),
      locationName: "Berlin",
    };
    // Synthetic page in the shape of jobs.ashbyhq.com (window.__appData).
    const page = `<html><body><div id="root"></div><script>window.__appData = ${JSON.stringify({ organization: { name: "Ramp" }, posting })};</script></body></html>`;
    const open = fixtureHttp(["ashby-board"], {
      [`https://jobs.ashbyhq.com/ramp/${id}`]: page,
    });
    const f = fields(
      await fetchVacancy(`https://jobs.ashbyhq.com/ramp/${id}`, open),
    );
    expect(f).toMatchObject({
      title: "Unlisted Frontend Engineer",
      ats: "ashby",
      atsJobId: id,
    });
    const gone = fixtureHttp(["ashby-board"], {
      [`https://jobs.ashbyhq.com/ramp/${id}`]:
        "<html><body><div id=root></div></body></html>",
    });
    expect(
      await fetchVacancy(`https://jobs.ashbyhq.com/ramp/${id}`, gone),
    ).toMatchObject({ ok: false, status: "closed" });
  });

  it("Workable: v2 job API", async () => {
    const http = fixtureHttp(["workable-v2"]);
    const f = fields(
      await fetchVacancy(
        "https://apply.workable.com/soda-data-nv/j/C0FCA11DED/apply/?autofill",
        http,
      ),
    );
    expect(f).toMatchObject({
      provider: "workable",
      title: "AI Content Engineer",
      remote: true,
      atsJobId: "C0FCA11DED",
      applyUrl: "https://apply.workable.com/soda-data-nv/j/C0FCA11DED/apply/",
    });
    expect(f.text).toContain("Requirements");
  });

  it("Workable: the widget list when v2 has no job; closed when the list lacks it", async () => {
    const http = fixtureHttp(["workable-widget"]);
    const f = fields(
      await fetchVacancy(
        "https://apply.workable.com/soda-data-nv/j/C0FCA11DED/",
        http,
      ),
    );
    expect(f.company).toBe("Soda Data");
    expect(f.remote).toBe(true);
    expect(
      await fetchVacancy(
        "https://apply.workable.com/soda-data-nv/j/ABCDEF1234/",
        http,
      ),
    ).toMatchObject({
      ok: false,
      status: "closed",
    });
  });

  it("SmartRecruiters: public postings API (a German posting passes the browser-only rule)", async () => {
    const http = fixtureHttp(["smartrecruiters-posting"]);
    const f = fields(
      await fetchVacancy(
        "https://jobs.smartrecruiters.com/ScalableGmbH/744000158036092",
        http,
      ),
    );
    expect(f).toMatchObject({
      provider: "smartrecruiters",
      company: "Scalable GmbH",
      location: "München, BY, Germany",
      remote: false,
      atsBoard: "ScalableGmbH",
    });
    expect(f.applyUrl).toContain(
      "jobs.smartrecruiters.com/ScalableGmbH/744000158036092",
    );
  });

  it("Workday: cxs API; the tenant with underscores when the host label fails", async () => {
    const http = fixtureHttp(["workday-job"]);
    const f = fields(
      await fetchVacancy(
        "https://osv-a10networks.wd503.myworkdayjobs.com/en-US/A10CareerSite/job/San-Jose-California/Staff-Frontend-Software-Engineer---Management-Solution_R-101381",
        http,
      ),
    );
    expect(http.requests).toHaveLength(2);
    expect(f).toMatchObject({
      provider: "workday",
      company: "A10 Networks, Inc.",
      atsBoard: "osv_a10networks",
      atsJobId: "R-101381",
      postedAt: "2026-10-27T00:00:00.000Z",
    });
    expect(f.applyUrl).toMatch(/_R-101381\/apply$/);
  });

  it("Rippling: board API with pay range", async () => {
    const http = fixtureHttp(["rippling-job"]);
    const f = fields(
      await fetchVacancy(
        "https://ats.rippling.com/rippling/jobs/91ae85ae-9d73-4eb3-a1e2-2c0fe32c7c77",
        http,
      ),
    );
    expect(f).toMatchObject({
      provider: "rippling",
      ats: "other",
      company: "Rippling",
      salary: { min: 189000, max: 315000, currency: "USD", period: "year" },
    });
  });

  it("Teamtailor and Personio: JSON-LD JobPosting tagged with the ATS", async () => {
    const teamtailor = fields(
      await fetchVacancy(
        "https://utorg.teamtailor.com/jobs/8220725-lead-senior-backend-developer-typescript-node-js",
        fixtureHttp(["teamtailor-page"]),
      ),
    );
    expect(teamtailor).toMatchObject({
      provider: "teamtailor",
      ats: "teamtailor",
      atsBoard: "utorg",
      atsJobId: "8220725",
      remote: true,
    });
    const personio = fields(
      await fetchVacancy(
        "https://exnaton-ag.jobs.personio.com/job/2810480",
        fixtureHttp(["personio-page"]),
      ),
    );
    expect(personio).toMatchObject({
      provider: "personio",
      ats: "personio",
      company: "exnaton AG",
    });
  });
});

describe("aggregators", () => {
  it("hirify: the vacancy from the Nuxt payload, hirify's own blocks cut", async () => {
    const result = await fetchVacancy(
      "https://hirify.me/jobs/1328246-senior-ui-ux-designer-react",
      fixtureHttp(["hirify-job"]),
    );
    const f = fields(result);
    expect(f).toMatchObject({
      provider: "hirify",
      company: "Bright Vision Technologies",
      remote: true,
      salary: { min: 135000, max: 155000, currency: "USD", period: "year" },
      postedAt: "2026-10-28T00:47:24.000Z",
    });
    expect(f.text).not.toMatch(/TL;DR|Будьте осторожны/);
  });

  it("hirify: the original ATS link from a page's contacts", () => {
    const vacancy = {
      id: 1,
      slug: "1-frontend",
      title: "Frontend Engineer",
      company_title: "%hirify_global%",
      text: longBody("dashboards for %hirify_global%"),
      work_format: ["remote"],
      created_at: "2026-10-27T10:00:00.000000Z",
      contacts: [
        {
          type: "url",
          value:
            "https://jobs.lever.co/acme/d47ed113-862f-4581-9968-5539b47a7a4e",
        },
      ],
    };
    const html = `<html><body>${nuxtPayload({ data: { "vacancy-1-frontend": vacancy } })}</body></html>`;
    const f = fields(
      extractVacancyFromHtml("https://hirify.me/jobs/1-frontend", html),
    );
    expect(f).toMatchObject({
      originalUrl:
        "https://jobs.lever.co/acme/d47ed113-862f-4581-9968-5539b47a7a4e",
      ats: "lever",
      atsBoard: "acme",
      applyUrl:
        "https://jobs.lever.co/acme/d47ed113-862f-4581-9968-5539b47a7a4e/apply",
      company: "Acme",
      remote: true,
    });
    expect(f.text).not.toContain("%hirify_global%");
  });

  it("wantapply: a Cloudflare challenge is not bypassed", async () => {
    const result = await fetchVacancy(
      "https://wantapply.com/frontend-engineer-at-loora?from=category",
      fixtureHttp(["wantapply-challenge"]),
    );
    expect(result).toMatchObject({ ok: false, status: "browser" });
    expect(!result.ok && result.reason).toMatch(/Bot protection/);
  });

  it("wantapply: a rendered page gives the vacancy and its original ATS link", () => {
    const posting = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Frontend Engineer",
      hiringOrganization: { "@type": "Organization", name: "Loora" },
      datePosted: "2026-10-20",
      jobLocationType: "TELECOMMUTE",
      description: longBody("a language app"),
    };
    // Synthetic page: plain HTTP never gets the real one (see the test above).
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(posting)}</script></head>
      <body><h1>Frontend Engineer</h1><a href="https://jobs.ashbyhq.com/loora/f2a31e7f-d110-48e7-a908-b7a79c0f0050">Apply on the company site</a></body></html>`;
    const f = fields(
      extractVacancyFromHtml(
        "https://wantapply.com/frontend-engineer-at-loora",
        html,
      ),
    );
    expect(f).toMatchObject({
      provider: "wantapply",
      company: "Loora",
      remote: true,
      originalUrl:
        "https://jobs.ashbyhq.com/loora/f2a31e7f-d110-48e7-a908-b7a79c0f0050",
      applyUrl:
        "https://jobs.ashbyhq.com/loora/f2a31e7f-d110-48e7-a908-b7a79c0f0050/application",
      ats: "ashby",
      postedAt: "2026-10-20T00:00:00.000Z",
    });
  });
});

describe("page fallback", () => {
  const page = (body: string, head = "") =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  it("JSON-LD JobPosting with salary and location", () => {
    const posting = {
      "@type": ["JobPosting"],
      title: "Senior Backend Engineer &amp; Mentor",
      hiringOrganization: "Acme",
      datePosted: "2026-10-01T09:30:00+02:00",
      jobLocation: {
        address: {
          addressLocality: "Tbilisi",
          addressCountry: { name: "Georgia" },
        },
      },
      baseSalary: {
        currency: "EUR",
        value: { minValue: 4000, maxValue: 6000, unitText: "MONTH" },
      },
      description: longBody("payments"),
    };
    const html = page(
      "<h1>x</h1>",
      `<script type="application/ld+json">${JSON.stringify({ "@graph": [posting] })}</script>`,
    );
    const result = extractVacancyFromHtml(
      "https://careers.acme.com/jobs/42",
      html,
    );
    const f = fields(result);
    expect(result.ok && result.source).toBe("json-ld");
    expect(f).toMatchObject({
      title: "Senior Backend Engineer & Mentor",
      company: "Acme",
      location: "Tbilisi, Georgia",
      postedAt: "2026-10-01T07:30:00.000Z",
      salary: { min: 4000, max: 6000, currency: "EUR", period: "month" },
      provider: "careers.acme.com",
    });
  });

  it("__NEXT_DATA__ job object", () => {
    const data = {
      props: {
        pageProps: {
          job: {
            title: "Fullstack Developer",
            description: longBody("a CRM"),
            companyName: "Kommo",
            location: { name: "Remote" },
          },
        },
      },
    };
    const html = page(
      `<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`,
    );
    const result = extractVacancyFromHtml(
      "https://example.com/careers/fullstack",
      html,
    );
    expect(fields(result)).toMatchObject({
      title: "Fullstack Developer",
      company: "Kommo",
      remote: true,
    });
    expect(result.ok && result.source).toBe("next-data");
  });

  it("main text without navigation, footer or similar jobs", () => {
    const html = page(
      `<header><nav><a href="/">Home</a><a href="/jobs">All jobs</a></nav></header>
       <main><h1>Frontend Developer</h1>${longBody("a design system")}
       <h3>Similar Jobs</h3><ul><li><a href="/2">Backend Developer</a></li></ul></main>
       <footer>© Acme · Privacy · Cookies settings and a long footer text that should not be read</footer>`,
      `<meta property="og:site_name" content="Acme Careers">`,
    );
    const result = extractVacancyFromHtml(
      "https://jobs.acme.com/frontend",
      html,
    );
    const f = fields(result);
    expect(result.ok && result.source).toBe("page-text");
    expect(f.title).toBe("Frontend Developer");
    expect(f.company).toBe("Acme Careers");
    expect(f.text).toContain("- Own services end to end");
    expect(f.text).not.toMatch(/All jobs|Privacy|Backend Developer/);
  });

  it("a script shell is browser-only", async () => {
    const http = fixtureHttp([], {
      "https://app.example.com/job/1": page(
        '<div id="app"></div><script src="/app.js"></script>',
      ),
    });
    expect(
      await fetchVacancy("https://app.example.com/job/1", http),
    ).toMatchObject({ ok: false, status: "browser" });
  });

  it("refuses private addresses and survives network errors", async () => {
    expect(
      await fetchVacancy("http://127.0.0.1:8080/job", fixtureHttp([])),
    ).toMatchObject({ ok: false, status: "failed" });
    expect(
      await fetchVacancy("http://localhost/job", fixtureHttp([])),
    ).toMatchObject({ ok: false, status: "failed" });
    const broken: Http = {
      async get() {
        throw new Error("socket hang up");
      },
    };
    expect(
      await fetchVacancy(
        "https://jobs.lever.co/acme/d47ed113-862f-4581-9968-5539b47a7a4e",
        broken,
      ),
    ).toMatchObject({
      ok: false,
      status: "failed",
      reason: "socket hang up",
    });
  });

  it("a 404 page is closed, a redirect to the job list is closed", async () => {
    expect(
      await fetchVacancy(
        "https://careers.example.com/jobs/123-engineer",
        fixtureHttp([]),
      ),
    ).toMatchObject({
      ok: false,
      status: "closed",
    });
    const http = fixtureHttp([], {
      "https://careers.example.com/jobs/123-engineer": {
        status: 200,
        url: "https://careers.example.com/jobs",
        text: page(longBody("x")),
      },
    });
    expect(
      await fetchVacancy("https://careers.example.com/jobs/123-engineer", http),
    ).toMatchObject({ ok: false, status: "closed" });
  });
});
