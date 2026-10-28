import { describe, expect, it } from "vitest";
import { vacancyKeys, vacancyTextKey, vacancyUrlKey } from "./identity.js";

describe("vacancyUrlKey (Work Finder port)", () => {
  it("one key regardless of scheme, host case, www, fragment, trailing slash and tracking", () => {
    const key = vacancyUrlKey(
      "https://jobs.lever.co/Fliff/cc2b709e-a8a1-4ece-a4f9-3eea8e0e0345",
    );
    for (const variant of [
      "http://jobs.lever.co/Fliff/cc2b709e-a8a1-4ece-a4f9-3eea8e0e0345/",
      "https://JOBS.lever.co/Fliff/cc2b709e-a8a1-4ece-a4f9-3eea8e0e0345#apply",
      "https://jobs.lever.co/Fliff/cc2b709e-a8a1-4ece-a4f9-3eea8e0e0345?utm_source=linkedin&lever-source=LinkedIn&ref=feed",
    ])
      expect(vacancyUrlKey(variant)).toBe(key);
    expect(
      vacancyUrlKey(
        "https://www.dataannotation.tech/job-board/frontend-engineer",
      ),
    ).toBe(
      vacancyUrlKey("https://dataannotation.tech/job-board/frontend-engineer/"),
    );
  });

  it("parameters that name the job keep links apart, whatever their order", () => {
    expect(
      vacancyUrlKey(
        "https://careers.kaizengaming.com/job-details/?gh_jid=5631632003",
      ),
    ).not.toBe(
      vacancyUrlKey(
        "https://careers.kaizengaming.com/job-details/?gh_jid=5631632004",
      ),
    );
    expect(vacancyUrlKey("https://example.com/job?b=2&a=1&utm_medium=x")).toBe(
      vacancyUrlKey("https://example.com/job?a=1&b=2"),
    );
    expect(vacancyUrlKey("https://hirify.me/jobs/1169933-frontend")).not.toBe(
      vacancyUrlKey("https://hirify.me/jobs/1169114-frontend"),
    );
  });

  it("form and confirmation pages, success / autofill flags", () => {
    const pairs: [string, string][] = [
      [
        "https://jobs.lever.co/truv/2a05f4f2-096c-4b4b-9d96-39928f66b529/apply",
        "https://jobs.lever.co/truv/2a05f4f2-096c-4b4b-9d96-39928f66b529",
      ],
      [
        "https://jobs.lever.co/swingdev/94ec789f-dd5a-433e-b6ee-45b5a3054bd9/thanks",
        "https://jobs.lever.co/swingdev/94ec789f-dd5a-433e-b6ee-45b5a3054bd9",
      ],
      [
        "https://jobs.ashbyhq.com/0g/364e76dd-6b42-43f5-a27d-a0d1fd4b37c7/application",
        "https://jobs.ashbyhq.com/0g/364e76dd-6b42-43f5-a27d-a0d1fd4b37c7",
      ],
      [
        "https://apply.workable.com/gramian/j/4C525A9FA2/apply/?success",
        "https://apply.workable.com/gramian/j/4C525A9FA2/",
      ],
      [
        "https://apply.workable.com/workana-premium/j/4CDE115ACD/apply/?autofill",
        "https://apply.workable.com/workana-premium/j/4CDE115ACD",
      ],
      [
        "https://job-boards.greenhouse.io/apolloio/jobs/6142289004/confirmation",
        "https://boards.greenhouse.io/apolloio/jobs/6142289004",
      ],
      [
        "https://jobs.smartrecruiters.com/oneclick-ui/company/ScalableGmbH/publication/562c53f4-079b-4bc7-812b-41c747222839/success?dcr_ci=ScalableGmbH",
        "https://jobs.smartrecruiters.com/oneclick-ui/company/ScalableGmbH/publication/562c53f4-079b-4bc7-812b-41c747222839/",
      ],
      [
        "https://wantapply.com/fullstack-engineer-at-gomining?from=category",
        "https://wantapply.com/fullstack-engineer-at-gomining",
      ],
      [
        "https://acme.workable.com/j/4c525a9fa2",
        "https://apply.workable.com/acme/j/4C525A9FA2",
      ],
    ];
    for (const [a, b] of pairs) expect(vacancyUrlKey(a)).toBe(vacancyUrlKey(b));
    // A careers page called /apply is not a form tail.
    expect(vacancyUrlKey("https://acme.com/apply")).toBe("acme.com/apply");
    // EU and US Greenhouse boards stay apart.
    expect(
      vacancyUrlKey("https://job-boards.eu.greenhouse.io/dwelly/jobs/1"),
    ).not.toBe(vacancyUrlKey("https://job-boards.greenhouse.io/dwelly/jobs/1"));
  });
});

describe("vacancyTextKey and roleKey", () => {
  it("text key ignores case and whitespace", () => {
    expect(
      vacancyTextKey("Senior Frontend Engineer\n\nReact,  TypeScript "),
    ).toBe(vacancyTextKey("senior frontend engineer react, typescript"));
    expect(vacancyTextKey("Senior Frontend Engineer")).not.toBe(
      vacancyTextKey("Senior Backend Engineer"),
    );
  });

  it("one role key for one vacancy on two boards", () => {
    const ats = vacancyKeys({
      url: "https://osv-a10networks.wd503.myworkdayjobs.com/A10CareerSite/job/x_R-101381",
      text: "a",
      company: "A10 Networks, Inc.",
      title: "Staff Frontend Software Engineer – Management Solution",
      location: "San Jose, California",
    });
    const board = vacancyKeys({
      url: "https://hirify.me/jobs/1328347-staff-frontend-react-engineer",
      text: "b",
      company: "A10 Networks",
      title: "Staff Front-End Software Engineer (Management Solution)",
      location: "San Jose California",
    });
    expect(board.roleKey).toBe(ats.roleKey);
    expect(ats.roleKey).toBe(
      "a10 networks|staff frontend software engineer management solution|san jose california",
    );
    expect(board.urlKey).not.toBe(ats.urlKey);
    expect(
      vacancyKeys({
        url: "https://x.io/1",
        text: "",
        company: "Acme GmbH",
        title: "Sr. Full Stack Dev (m/f/d)",
        location: null,
      }).roleKey,
    ).toBe("acme|senior fullstack developer|");
  });
});
