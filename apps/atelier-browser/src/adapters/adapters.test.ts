import { describe, expect, it } from "vitest";
import { safeFileName } from "../engine/apply.js";
import { greenhouseEmbedUrl } from "./greenhouse.js";
import { adapters } from "./index.js";

const form = (ats: keyof typeof adapters, url: string) => {
  const adapter = adapters[ats];
  const parsed = new URL(url);
  return adapter.matches(parsed) ? adapter.formUrl(parsed) : null;
};

describe("ATS URLs", () => {
  it("ashby: posting or application URL → the application form", () => {
    expect(
      form(
        "ashby",
        "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
      ),
    ).toBe(
      "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application",
    );
    expect(
      form(
        "ashby",
        "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application?utm_source=x",
      ),
    ).toBe(
      "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application",
    );
    expect(form("ashby", "https://jobs.lever.co/acme/123")).toBeNull();
  });

  it("lever: US and EU hosts → /apply", () => {
    expect(
      form(
        "lever",
        "https://jobs.lever.co/acme/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2",
      ),
    ).toBe(
      "https://jobs.lever.co/acme/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2/apply",
    );
    expect(
      form(
        "lever",
        "https://jobs.eu.lever.co/acme/10dfc8bc/apply?lever-source=x",
      ),
    ).toBe("https://jobs.eu.lever.co/acme/10dfc8bc/apply");
    expect(form("lever", "https://lever.co/acme")).toBeNull();
  });

  it("greenhouse: boards, job-boards, EU, embed and company pages with gh_jid", () => {
    expect(
      form(
        "greenhouse",
        "https://boards.greenhouse.io/acme/jobs/5426468004?gh_jid=5426468004",
      ),
    ).toBe("https://job-boards.greenhouse.io/acme/jobs/5426468004");
    expect(
      form("greenhouse", "https://job-boards.eu.greenhouse.io/acme/jobs/4001"),
    ).toBe("https://job-boards.eu.greenhouse.io/acme/jobs/4001");
    expect(
      form(
        "greenhouse",
        "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4001",
      ),
    ).toBe(
      "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4001",
    );
    // A company site embedding the form: opened as is, then followed to the iframe.
    expect(form("greenhouse", "https://acme.com/careers/job?gh_jid=4001")).toBe(
      "https://acme.com/careers/job?gh_jid=4001",
    );
    expect(form("greenhouse", "https://acme.com/careers/job")).toBeNull();
    expect(greenhouseEmbedUrl("acme", "4001")).toBe(
      "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4001",
    );
  });

  it("workable: account, short and legacy URLs → /apply/", () => {
    expect(
      form("workable", "https://apply.workable.com/huggingface/j/81B46579FE/"),
    ).toBe("https://apply.workable.com/huggingface/j/81B46579FE/apply/");
    expect(
      form("workable", "https://apply.workable.com/j/81B46579FE/apply"),
    ).toBe("https://apply.workable.com/j/81B46579FE/apply/");
    expect(
      form("workable", "https://huggingface.workable.com/j/81B46579FE"),
    ).toBe("https://apply.workable.com/huggingface/j/81B46579FE/apply/");
    expect(
      form("workable", "https://www.workable.com/j/81B46579FE"),
    ).toBeNull();
  });
});

describe("CV file name", () => {
  it("keeps the given name, without directories", () => {
    expect(
      safeFileName("Alex_Example_Software_Engineer_CV.pdf", "CV.pdf"),
    ).toBe("Alex_Example_Software_Engineer_CV.pdf");
    expect(safeFileName("../../etc/passwd", "CV.pdf")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\cv.pdf", "CV.pdf")).toBe("cv.pdf");
    expect(safeFileName("..", "CV.pdf")).toBe("CV.pdf");
  });
});
