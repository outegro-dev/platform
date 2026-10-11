/** The visitor's answer about reader statistics, readable on both sides. */
export type Consent = "granted" | "denied";

/** First-party cookie that keeps the answer for a year. */
export const CONSENT_COOKIE = "og_consent";

export const parseConsent = (value: string | undefined): Consent | undefined =>
  value === "granted" || value === "denied" ? value : undefined;
