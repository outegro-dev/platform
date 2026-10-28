import { type AtsAdapter, segments } from "./adapter.js";

const HOSTS = new Set(["jobs.lever.co", "jobs.eu.lever.co"]);

/** jobs.lever.co/<company>/<posting id>/apply, EU: jobs.eu.lever.co */
export const lever: AtsAdapter = {
  ats: "lever",
  matches: (url) => HOSTS.has(url.hostname),
  formUrl(url) {
    const [company, id] = segments(url);
    if (!company || !id) return url.toString();
    return `https://${url.hostname}/${company}/${id}/apply`;
  },
  formSelectors: ["form#application-form", "form.application-form", "form"],
  ignoreSelectors: [],
  submitSelectors: ["#btn-submit", "button[data-qa=btn-submit]"],
  successSelectors: [
    "[data-qa=msg-submit-success]",
    ".application-confirmation",
  ],
  // The location field is a text input with its own suggestion list.
  locationSuggestions: ".dropdown-results .dropdown-location",
  // Lever parses the CV right away: "Success!" or "Couldn't auto-read resume."
  uploadDone: ".resume-upload-success:visible, .resume-upload-failure:visible",
};
