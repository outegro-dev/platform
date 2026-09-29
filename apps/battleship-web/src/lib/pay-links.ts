import { hostOf, pageHref } from "@outegro/ui/lib/platform";
import { env, platformUrls } from "./env";

/** Links to pay.outegro.dev that offer the way back to a page of the game. */
export type PayLinks = {
  /** Renewal and cancellation of Premium. */
  subscriptions: string;
  /** Orders and receipts, the Silver Fleet among them. */
  purchases: string;
  /** Where payments happen, as the shop names it: "pay.outegro.dev". */
  host: string;
};

/** Server only (reads the app's configuration); pass the result to the page. */
export function payLinks(backTo: string): PayLinks {
  const returnTo = new URL(backTo, env.APP_URL).toString();
  return {
    subscriptions: pageHref(platformUrls, "subscriptions", { returnTo }),
    purchases: pageHref(platformUrls, "purchases", { returnTo }),
    host: hostOf(platformUrls.pay) ?? "pay.outegro.dev",
  };
}
