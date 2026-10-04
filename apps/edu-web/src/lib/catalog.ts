import { type PlatformUrls, platformHref } from "@outegro/ui/lib/platform";

/*
 * How a reader without access gets it. Which catalog product unlocks a book
 * is the engine's rule (`offerFor`); this is where the link leads: the
 * product on pay.outegro.dev once there is one, until then an invitation
 * through the contact form.
 */

export type AccessOffer =
  /** A product on pay.outegro.dev that unlocks the book. */
  | { kind: "catalog"; href: string; productKey: string }
  /** No product yet: access by invitation, through the contact form. */
  | { kind: "invitation"; href: string };

/** Where "get access" leads; `returnTo` is the absolute URL of this page. */
export function accessOffer(
  productKey: string | null,
  returnTo: string,
  urls: PlatformUrls,
): AccessOffer {
  if (productKey)
    return {
      kind: "catalog",
      productKey,
      href: `${platformHref(urls, "pay", "/catalog", { returnTo })}#${encodeURIComponent(productKey)}`,
    };
  return {
    kind: "invitation",
    href: `${urls.site.replace(/\/+$/, "")}/#contact`,
  };
}
