import { platformRoles } from "@outegro/contracts/access";
import { describe, expect, it } from "vitest";
import {
  type AccountMenuInput,
  type AccountMenuModel,
  accountMenuMessages,
  accountMenuModel,
  hostOf,
  initialsOf,
  pageHref,
  platformHref,
  productionPlatformUrls,
} from "./platform";

const urls = productionPlatformUrls;
const nick = { name: "Nick Lukashik", email: "nick@outegro.test", roles: [] };

const model = (input: Partial<AccountMenuInput> = {}) =>
  accountMenuModel({
    user: nick,
    urls,
    current: "battleship",
    locale: "en",
    ...input,
  });

const group = (menu: AccountMenuModel, key: string) =>
  menu.groups.find((entry) => entry.key === key)?.items ?? [];
const hrefs = (menu: AccountMenuModel, key: string) =>
  Object.fromEntries(group(menu, key).map((item) => [item.key, item.href]));

describe("account menu model", () => {
  it("links the account on id and purchases on pay, with the way back", () => {
    const menu = model({ returnTo: "https://battleship.outegro.dev/shop" });
    expect(hrefs(menu, "account")).toEqual({
      profile: "https://id.outegro.dev/account",
      security: "https://id.outegro.dev/account/security",
      notifications: "https://id.outegro.dev/account/notifications",
      purchases:
        "https://pay.outegro.dev/orders?return=https%3A%2F%2Fbattleship.outegro.dev%2Fshop",
    });
  });

  it("keeps the host app's own pages relative and never returns to itself", () => {
    expect(hrefs(model({ current: "id" }), "account")).toMatchObject({
      profile: "/account",
      security: "/account/security",
      notifications: "/account/notifications",
      purchases: "https://pay.outegro.dev/orders",
    });
    const pay = model({
      current: "pay",
      returnTo: "https://pay.outegro.dev/orders",
    });
    expect(hrefs(pay, "account").purchases).toBe("/orders");
    expect(hrefs(pay, "apps")["app-pay"]).toBe("/orders");
  });

  it("lists the apps with their addresses and marks the current one", () => {
    const apps = group(model(), "apps");
    expect(apps.map((app) => [app.label, app.host, app.current])).toEqual([
      ["Battleship", "battleship.outegro.dev", true],
      ["Account", "id.outegro.dev", false],
      ["Payments", "pay.outegro.dev", false],
    ]);
    expect(apps.map((app) => app.href)).toEqual([
      "/",
      "https://id.outegro.dev/account",
      "https://pay.outegro.dev/orders",
    ]);
    expect(group(model(), "site")).toEqual([
      expect.objectContaining({
        label: "Portfolio",
        href: "https://outegro.dev/",
        host: "outegro.dev",
      }),
    ]);
  });

  it("adds the admin console for every platform role and nothing else", () => {
    for (const role of Object.keys(platformRoles)) {
      const admin = group(model({ user: { ...nick, roles: [role] } }), "apps");
      expect(admin.at(-1), role).toMatchObject({
        key: "app-admin",
        label: "Admin console",
        href: "https://admin.outegro.dev/",
        host: "admin.outegro.dev",
      });
    }
    for (const roles of [[], null, undefined, ["premium"], ["constructor"]]) {
      const apps = group(model({ user: { ...nick, roles } }), "apps");
      expect(
        apps.map((app) => app.key),
        JSON.stringify(roles),
      ).not.toContain("app-admin");
    }
  });

  it("names who is signed in: display name, else email, else a generic title", () => {
    expect(model().person).toEqual({
      title: "Nick Lukashik",
      subtitle: "nick@outegro.test",
      initials: "NL",
    });
    expect(
      model({ user: { name: "  ", email: "anna@outegro.test" } }).person,
    ).toEqual({ title: "anna@outegro.test", subtitle: null, initials: "A" });
    expect(model({ user: {} }).person).toEqual({
      title: "Your account",
      subtitle: null,
      initials: "",
    });
    expect(model({ user: {}, locale: "ru" }).person.title).toBe("Ваш аккаунт");
  });

  it("speaks the host app's language, English by default", () => {
    const ru = model({ locale: "ru", user: { ...nick, roles: ["owner"] } });
    expect(ru.groups.map((entry) => entry.label)).toEqual([
      "Ваш аккаунт",
      "Приложения",
      null,
    ]);
    expect(group(ru, "account").map((item) => item.label)).toEqual([
      "Профиль",
      "Безопасность",
      "Уведомления",
      "Покупки и подписки",
    ]);
    expect(group(ru, "apps").map((item) => item.label)).toEqual([
      "Морской бой",
      "Аккаунт",
      "Платежи",
      "Админка",
    ]);
    expect(ru.messages.signOut).toBe("Выйти");
    for (const locale of ["en", "de", "", null, undefined])
      expect(model({ locale }).messages.signOut, String(locale)).toBe(
        "Sign out",
      );
  });

  it("follows the configured addresses", () => {
    const local = model({
      urls: {
        site: "http://localhost:3000/",
        id: "http://localhost:3002/",
        pay: "http://localhost:3003",
        battleship: "http://localhost:3005",
        admin: "http://localhost:3004",
      },
      user: { ...nick, roles: ["support"] },
      returnTo: "http://localhost:3005/",
    });
    expect(hrefs(local, "account").security).toBe(
      "http://localhost:3002/account/security",
    );
    expect(hrefs(local, "apps")).toEqual({
      "app-battleship": "/",
      "app-id": "http://localhost:3002/account",
      "app-pay":
        "http://localhost:3003/orders?return=http%3A%2F%2Flocalhost%3A3005%2F",
      "app-admin": "http://localhost:3004/",
    });
    expect(group(local, "apps")[1]?.host).toBe("localhost:3002");
  });
});

describe("platform links", () => {
  it("adds the way back to payments pages only", () => {
    const back = "https://id.outegro.dev/account";
    expect(pageHref(urls, "subscriptions", { returnTo: back })).toBe(
      "https://pay.outegro.dev/subscriptions?return=https%3A%2F%2Fid.outegro.dev%2Faccount",
    );
    expect(pageHref(urls, "security", { returnTo: back })).toBe(
      "https://id.outegro.dev/account/security",
    );
    expect(
      platformHref(urls, "pay", "/orders?cursor=abc", { returnTo: back }),
    ).toBe(
      "https://pay.outegro.dev/orders?cursor=abc&return=https%3A%2F%2Fid.outegro.dev%2Faccount",
    );
  });

  it("reads hosts and initials", () => {
    expect(hostOf("https://pay.outegro.dev")).toBe("pay.outegro.dev");
    expect(hostOf("not a url")).toBeNull();
    expect(initialsOf("Анна Каренина")).toBe("АК");
    expect(initialsOf("  grace   o'malley  hopper ")).toBe("GO");
    expect(initialsOf("🚢 Nemo")).toBe("N");
    expect(initialsOf("1st Mate")).toBe("1M");
    expect(initialsOf("_x@outegro.test")).toBe("X");
    expect(initialsOf(null)).toBe("");
  });
});

describe("account menu words", () => {
  const flatten = (value: object, prefix = ""): Record<string, string> =>
    Object.entries(value).reduce<Record<string, string>>(
      (all, [key, text]) =>
        typeof text === "string"
          ? Object.assign(all, { [`${prefix}${key}`]: text })
          : Object.assign(all, flatten(text as object, `${prefix}${key}.`)),
      {},
    );

  it("exist in English and Russian, none of them empty", () => {
    const en = flatten(accountMenuMessages.en);
    const ru = flatten(accountMenuMessages.ru);
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries({ ...en, ...ru }))
      expect(text.trim(), key).not.toBe("");
  });
});
