import { describe, expect, it } from "vitest";
import { fixtureHttp, loadFixture } from "./__fixtures__/fixture-http.js";
import { isBrowserOnly, redirectedToList } from "./browser-only.js";
import { checkLiveness } from "./liveness.js";

const lever =
  "https://jobs.lever.co/zartis/d47ed113-862f-4581-9968-5539b47a7a4e";
const leverPage =
  "<html><body><h1>Agentic Product Engineers</h1><p>Apply for this job</p></body></html>";

describe("checkLiveness (Work Finder rules)", () => {
  it("open: the API has the posting and its page answers", async () => {
    expect(
      await checkLiveness(
        lever,
        fixtureHttp(["lever-posting"], { [lever]: leverPage }),
      ),
    ).toBe("open");
  });

  it("closed: the page and the API answer 404", async () => {
    const url =
      "https://jobs.lever.co/swingdev/94ec789f-dd5a-433e-b6ee-45b5a3054bd9/thanks";
    expect(await checkLiveness(url, fixtureHttp(["lever-closed"]))).toBe(
      "closed",
    );
  });

  it("closed: Workable no longer lists it", async () => {
    const url = "https://apply.workable.com/soda-data-nv/j/ABCDEF1234/";
    expect(
      await checkLiveness(
        url,
        fixtureHttp(["workable-widget"], {
          [url]: "<html><body></body></html>",
        }),
      ),
    ).toBe("closed");
  });

  it("closed: the page says so, or redirects to the list of jobs", async () => {
    const page = "https://careers.example.com/jobs/senior-engineer";
    const said = fixtureHttp([], {
      [page]:
        "<html><body><h1>Senior Engineer</h1><p>This position has been filled. We are no longer accepting applications.</p></body></html>",
    });
    expect(await checkLiveness(page, said)).toBe("closed");
    const moved = fixtureHttp([], {
      [page]: {
        status: 200,
        url: "https://careers.example.com/jobs",
        text: "<html><body><h1>Open roles</h1></body></html>",
      },
    });
    expect(await checkLiveness(page, moved)).toBe("closed");
  });

  it("unknown: bot protection or a script shell", async () => {
    const challenge = loadFixture("wantapply-challenge");
    expect(
      await checkLiveness(
        "https://wantapply.com/frontend-engineer-at-loora?from=category",
        fixtureHttp(["wantapply-challenge"]),
      ),
    ).toBe("unknown");
    expect(Object.keys(challenge)).toHaveLength(1);
    const shell = "https://app.example.com/jobs/1";
    expect(
      await checkLiveness(
        shell,
        fixtureHttp([], { [shell]: '<div id="root"></div>' }),
      ),
    ).toBe("unknown");
  });
});

describe("signals", () => {
  it("isBrowserOnly: short or wordless text", () => {
    expect(isBrowserOnly("Loading…")).toBe(true);
    expect(isBrowserOnly("x".repeat(400))).toBe(true);
    expect(
      isBrowserOnly(
        `${"We build tools. ".repeat(20)}Requirements: TypeScript.`,
      ),
    ).toBe(false);
    expect(
      isBrowserOnly(
        `${"Wir bauen Software. ".repeat(20)}Deine Aufgaben: TypeScript.`,
      ),
    ).toBe(false);
  });

  it("redirectedToList", () => {
    expect(
      redirectedToList("https://a.com/jobs/123-dev", "https://a.com/jobs"),
    ).toBe(true);
    expect(
      redirectedToList(
        "https://a.com/jobs/123-dev",
        "https://a.com/jobs/123-dev/",
      ),
    ).toBe(false);
    expect(
      redirectedToList("https://a.com/jobs/123-dev", "https://b.com/jobs"),
    ).toBe(false);
  });
});
