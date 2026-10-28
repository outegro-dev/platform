import { type AtsAdapter, segments } from "./adapter.js";

/**
 * apply.workable.com/<account>/j/<code>/apply/; also the short
 * apply.workable.com/j/<code> and the legacy <account>.workable.com/j/<code>.
 */
export const workable: AtsAdapter = {
  ats: "workable",
  matches: (url) =>
    url.hostname === "apply.workable.com" ||
    /^(?!www\.)[a-z0-9-]+\.workable\.com$/.test(url.hostname),
  formUrl(url) {
    const parts = segments(url);
    const at = parts.indexOf("j");
    const code = at >= 0 ? parts[at + 1] : undefined;
    if (!code) return url.toString();
    const account =
      url.hostname === "apply.workable.com"
        ? at > 0
          ? parts[at - 1]
          : undefined
        : url.hostname.split(".")[0];
    return account
      ? `https://apply.workable.com/${account}/j/${code}/apply/`
      : `https://apply.workable.com/j/${code}/apply/`;
  },
  formSelectors: ["form[data-ui=application-form]", "main form", "form"],
  ignoreSelectors: [],
  submitSelectors: ["button[data-ui=apply-button]", "button[type=submit]"],
  successSelectors: [
    "[data-ui=successful-application]",
    "[data-ui=application-success]",
  ],
};
