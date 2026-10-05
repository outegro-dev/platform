import { productionPlatformUrls } from "@outegro/ui/lib/platform";
import { describe, expect, it } from "vitest";
import { accessOffer } from "./catalog";

describe("access link", () => {
  const urls = { ...productionPlatformUrls, edu: "https://edu.outegro.dev" };
  const page = "https://edu.outegro.dev/books/nodejs-internals/3";

  it("leads to the product on pay.outegro.dev, with the way back", () => {
    expect(accessOffer("edu-library", page, urls)).toEqual({
      kind: "catalog",
      productKey: "edu-library",
      href: `https://pay.outegro.dev/catalog?return=${encodeURIComponent(page)}#edu-library`,
    });
  });

  it("is an invitation through the contact form without a product", () => {
    expect(accessOffer(null, page, urls)).toEqual({
      kind: "invitation",
      href: "https://outegro.dev/#contact",
    });
    expect(
      accessOffer(null, page, { ...urls, site: "http://localhost:4198/site/" }),
    ).toEqual({
      kind: "invitation",
      href: "http://localhost:4198/site/#contact",
    });
  });
});
