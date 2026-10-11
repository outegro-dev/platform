import { productionPlatformUrls } from "@outegro/ui/lib/platform";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import { returnApps, returnTarget } from "./return-to";
import { serviceLink } from "./services";

// With no configuration the apps have their production addresses; ID_URL
// and this app's APP_URL default to local development.

describe("returnTarget", () => {
  it("accepts a page of a platform app and names the app", () => {
    expect(returnTarget("https://battleship.outegro.dev/shop")).toEqual({
      href: "https://battleship.outegro.dev/shop",
      app: "battleship",
    });
    expect(returnTarget("https://edu.outegro.dev/")).toEqual({
      href: "https://edu.outegro.dev/",
      app: "edu",
    });
    expect(returnTarget("http://localhost:3002/account")).toEqual({
      href: "http://localhost:3002/account",
      app: "id",
    });
    expect(returnTarget("https://admin.outegro.dev/")).toEqual({
      href: "https://admin.outegro.dev/",
      app: "admin",
    });
  });

  it("accepts the portfolio site, the account menu's home there", () => {
    expect(returnTarget("https://outegro.dev/")).toEqual({
      href: "https://outegro.dev/",
      app: "site",
    });
    expect(returnTarget("https://outegro.dev/stack#ai")).toEqual({
      href: "https://outegro.dev/stack",
      app: "site",
    });
  });

  it.each([
    "https://evil.test/",
    "https://battleship.outegro.dev.evil.test/shop",
    "https://battleship.outegro.dev@evil.test/",
    "https://edu.outegro.dev.evil.test/",
    "https://outegro.dev.evil.test/",
    "https://www.outegro.dev/",
    "http://outegro.dev/",
    "http://battleship.outegro.dev/shop",
    "//battleship.outegro.dev/shop",
    "/orders",
    "javascript:alert(1)",
    // Payments itself is not a place to go back to.
    "http://localhost:3003/orders",
    "https://pay.outegro.dev/orders",
    "",
    null,
    undefined,
  ])("refuses %s", (value) => {
    expect(returnTarget(value)).toBeNull();
  });
});

describe("the way back", () => {
  it.each(returnApps)("is named for %s in every language", (app) => {
    // ReturnBar shows `return.to.<app>`; a missing one shows the raw key.
    for (const messages of [en, ru])
      expect((messages.return.to as Record<string, string>)[app]).toEqual(
        expect.any(String),
      );
  });
});

describe("serviceLink", () => {
  it("opens the app a purchase belongs to at its configured address", () => {
    expect(serviceLink("battleship", productionPlatformUrls)).toEqual({
      home: "https://battleship.outegro.dev/",
      shop: "https://battleship.outegro.dev/shop",
    });
    expect(
      serviceLink("battleship", {
        ...productionPlatformUrls,
        battleship: "http://localhost:3005/",
      }),
    ).toEqual({
      home: "http://localhost:3005/",
      shop: "http://localhost:3005/shop",
    });
    // Education has no shop page: a purchase leads to its home.
    expect(serviceLink("edu", productionPlatformUrls)).toEqual({
      home: "https://edu.outegro.dev/",
      shop: "https://edu.outegro.dev/",
    });
    expect(
      serviceLink("edu", {
        ...productionPlatformUrls,
        edu: "http://localhost:3006",
      }),
    ).toEqual({
      home: "http://localhost:3006/",
      shop: "http://localhost:3006/",
    });
    expect(serviceLink("assistant", productionPlatformUrls)).toBeNull();
    expect(serviceLink("constructor", productionPlatformUrls)).toBeNull();
    expect(serviceLink(null, productionPlatformUrls)).toBeNull();
  });
});
