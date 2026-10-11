import type { Consent } from "./consent";

/**
 * Google Consent Mode v2 defaults, then the GTM container, in one nonced
 * script at the top of <head>: the defaults are queued before gtm.js can
 * read the data layer, and 'strict-dynamic' trusts what it injects. Ads
 * signals stay denied for good, the site runs no ads. No <noscript> iframe:
 * without scripting nobody can be asked, so nothing loads.
 */
export function GtmBootstrap({
  id,
  nonce,
  consent,
}: {
  /** a GTM-… container id, already validated by env */
  id: string;
  nonce?: string;
  /** the stored answer, so a returning reader is counted from the first hit */
  consent?: Consent;
}) {
  const script = [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments)}",
    'gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied",wait_for_update:500});',
    consent === "granted"
      ? 'gtag("consent","update",{analytics_storage:"granted"});'
      : "",
    'dataLayer.push({"gtm.start":Date.now(),event:"gtm.js"});',
    'var s=document.createElement("script");s.async=true;',
    // the nonce on gtm.js too, as in Google's CSP guide: older browsers ignore 'strict-dynamic'
    nonce ? `s.nonce=${JSON.stringify(nonce)};` : "",
    `s.src="https://www.googletagmanager.com/gtm.js?id=${id}";`,
    "document.head.appendChild(s);",
  ].join("");
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script; the only inputs are the validated container id and the request nonce.
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />
  );
}
