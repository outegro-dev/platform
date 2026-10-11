import { useEffect, useState } from "react";
import { CONSENT_COOKIE, type Consent } from "./consent";

declare global {
  interface Window {
    /** Set up by the GTM bootstrap in <head>; queues commands for GTM. */
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const YEAR = 60 * 60 * 24 * 365;
// the banner and the privacy page settings follow one answer
const CHANGED = "og-consent";
// GA4's _ga and _ga_<stream>, plus _gid and _gat from older setups
const ANALYTICS_COOKIE = /^(_ga(_.+)?|_gid|_gat.*)$/;

/** Keeps the answer, tells GTM, and on a refusal wipes what GA wrote. */
export function saveConsent(consent: Consent) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: one plain first-party flag; the Cookie Store API is not everywhere yet.
  document.cookie = `${CONSENT_COOKIE}=${consent}; Max-Age=${YEAR}; Path=/; SameSite=Lax${secure}`;
  window.gtag?.("consent", "update", { analytics_storage: consent });
  // tags that require consent check it only when their trigger fires, so
  // the container fires GA4 again on this event, without a reload
  if (consent === "granted") {
    window.dataLayer?.push({ event: "og_consent_granted" });
  } else {
    forgetAnalytics();
  }
  window.dispatchEvent(new CustomEvent<Consent>(CHANGED, { detail: consent }));
}

/** GA writes its cookies on the widest domain it may, so try every parent. */
function forgetAnalytics() {
  const labels = location.hostname.split(".");
  const domains = labels.map((_, index) => labels.slice(index).join("."));
  for (const pair of document.cookie.split("; ")) {
    const name = pair.split("=")[0];
    if (!ANALYTICS_COOKIE.test(name)) continue;
    for (const domain of ["", ...domains.map((d) => `; Domain=${d}`)]) {
      // biome-ignore lint/suspicious/noDocumentCookie: expiring cookies GA wrote takes the same raw form.
      document.cookie = `${name}=; Max-Age=0; Path=/${domain}`;
    }
  }
}

/** The current answer: what the server read, then any change on this page. */
export function useConsent(initial?: Consent) {
  const [consent, setConsent] = useState(initial);
  useEffect(() => {
    const onChange = (event: Event) =>
      setConsent((event as CustomEvent<Consent>).detail);
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);
  return consent;
}
