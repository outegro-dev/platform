import { describe, expect, it } from "vitest";
import { offerFor } from "./catalog.js";

const features = ["library", "book.nodejs-internals"];

const battleship = {
  key: "battleship-premium",
  service: "battleship",
  feature: "premium",
  kind: "subscription",
  periodicity: "MONTHLY",
  prices: [],
};

describe("catalog offer", () => {
  it("is none while payments sells nothing for the books", () => {
    expect(offerFor(null, features)).toBeNull();
    expect(offerFor(undefined, features)).toBeNull();
    expect(offerFor("down", features)).toBeNull();
    expect(offerFor({ products: "nope" }, features)).toBeNull();
    expect(
      offerFor({ checkoutEnabled: true, products: [battleship] }, features),
    ).toBeNull();
  });

  it("finds an edu product whose feature unlocks the book", () => {
    const catalog = {
      checkoutEnabled: true,
      products: [
        battleship,
        { key: "edu-node", service: "edu", feature: "book.nodejs-internals" },
      ],
    };
    expect(offerFor(catalog, features)).toBe("edu-node");
  });

  it("ignores products of other services and other books", () => {
    const catalog = {
      products: [
        { key: "assistant-pro", service: "assistant", feature: "library" },
        { key: "edu-sql", service: "edu", feature: "book.sql-internals" },
      ],
    };
    expect(offerFor(catalog, features)).toBeNull();
  });

  it("prefers the book's own order of features", () => {
    const catalog = {
      products: [
        { key: "edu-node", service: "edu", feature: "book.nodejs-internals" },
        { key: "edu-library", service: "edu", feature: "library" },
      ],
    };
    expect(offerFor(catalog, features)).toBe("edu-library");
  });

  it("reads leniently: unknown periodicities and fields never break it", () => {
    const catalog = {
      products: [
        {
          key: "edu-library",
          service: "edu",
          feature: "library",
          kind: "subscription",
          periodicity: "YEARLY",
          trialDays: 7,
          prices: [{ money: { minor: "990", currency: "KZT", scale: 2 } }],
        },
      ],
    };
    expect(offerFor(catalog, features)).toBe("edu-library");
  });

  it("skips malformed and inactive entries", () => {
    const catalog = {
      products: [
        null,
        42,
        { service: "edu", feature: "library" },
        { key: "bad key/../", service: "edu", feature: "library" },
        { key: "edu-old", service: "edu", feature: "library", active: false },
        { key: "edu-odd", service: "edu", feature: "library", active: "yes" },
        { key: "edu-num", service: "edu", feature: 7 },
        {
          key: "edu-library",
          service: "edu",
          feature: "library",
          active: true,
        },
      ],
    };
    expect(offerFor(catalog, features)).toBe("edu-library");
  });
});
