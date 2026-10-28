import { type AtsAdapter, segments } from "./adapter.js";

/** jobs.ashbyhq.com/<org>/<posting id>/application */
export const ashby: AtsAdapter = {
  ats: "ashby",
  matches: (url) => url.hostname === "jobs.ashbyhq.com",
  formUrl(url) {
    const [org, id] = segments(url);
    if (!org || !id) return url.toString();
    return `https://jobs.ashbyhq.com/${org}/${id}/application`;
  },
  formSelectors: [
    ".ashby-job-posting-right-pane",
    ".ashby-application-form-container",
    "form",
  ],
  // "Autofill from resume" parses a CV into the fields; the CV goes to its own field.
  ignoreSelectors: [
    ".ashby-application-form-autofill-uploader",
    ".ashby-application-form-autofill-input-root",
  ],
  submitSelectors: [
    "button.ashby-application-form-submit-button",
    "button:has-text('Submit Application')",
  ],
  successSelectors: [
    ".ashby-application-form-success-container",
    "[class*=successContainer]",
  ],
};
