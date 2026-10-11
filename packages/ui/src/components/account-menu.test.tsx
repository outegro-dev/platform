import { productionPlatformUrls } from "@outegro/ui/lib/platform";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountMenu,
  AccountMenuPlaceholder,
  type AccountMenuProps,
} from "./account-menu";

/*
 * The server never renders a menu's items: they open in a portal in the
 * browser. With `menu.open` the menu renders open and in place, so the slots
 * a theme styles (items, separators) can be read from the HTML too.
 */
const menu = vi.hoisted(() => ({ open: false }));
vi.mock("radix-ui", async (importOriginal) => {
  const radix = await importOriginal<typeof import("radix-ui")>();
  const { createElement } = await import("react");
  const { Root, Portal } = radix.DropdownMenu;
  return {
    ...radix,
    DropdownMenu: {
      ...radix.DropdownMenu,
      Root: (props: ComponentProps<typeof Root>) =>
        createElement(Root, { ...props, open: menu.open || undefined }),
      Portal: (props: ComponentProps<typeof Portal>) =>
        menu.open ? props.children : createElement(Portal, props),
    },
  };
});

/*
 * What the server sends before any script runs: the menu button (its items
 * open in the browser, covered by each app's e2e tests), or "Sign in".
 */
const render = (props: Partial<AccountMenuProps> = {}) =>
  renderToStaticMarkup(
    <AccountMenu
      user={{ name: "Nick Lukashik", email: "nick@outegro.test", roles: [] }}
      current="battleship"
      urls={productionPlatformUrls}
      locale="en"
      signInHref="/auth/sign-in?returnTo=%2F"
      signOut="/auth/sign-out"
      {...props}
    />,
  );

/** Every opening tag with this attribute. */
const tagsWith = (html: string, attribute: string) =>
  html.match(new RegExp(`<[a-z]+ [^>]*${attribute}[^>]*>`, "g")) ?? [];

describe("AccountMenu", () => {
  it("is a clear Sign in link when nobody is signed in", () => {
    const html = render({ user: null });
    expect(html).toMatch(/^<a [^>]*href="\/auth\/sign-in\?returnTo=%2F"/);
    expect(html).toContain(">Sign in</a>");
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(render({ user: null, locale: "ru" })).toContain(">Войти</a>");
  });

  it("keeps crawlers off the sign-in redirect", () => {
    expect(render({ user: null })).toMatch(/^<a [^>]*rel="nofollow"/);
  });

  it("is a menu button named after the signed-in person", () => {
    const html = render();
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Nick Lukashik, account and apps"');
    expect(html).toContain(">NL</span>");
    expect(html).toContain('data-slot="account-menu-avatar"');
    expect(html).toContain('data-slot="account-menu-name"');
  });

  it("names the button in the host app's language", () => {
    expect(render({ locale: "ru" })).toContain(
      'aria-label="Nick Lukashik, аккаунт и приложения"',
    );
    expect(render({ user: {}, locale: "ru" })).toContain(
      'aria-label="Аккаунт и приложения"',
    );
  });

  it("keeps only the avatar when compact", () => {
    expect(render({ compact: true })).not.toContain("account-menu-name");
  });

  it("works on the portfolio site too, signed in or out", () => {
    expect(render({ current: "site" })).toContain('aria-haspopup="menu"');
    expect(render({ current: "site", user: null })).toContain(">Sign in</a>");
  });

  it("holds the button's place, hidden from assistive technology", () => {
    const html = renderToStaticMarkup(<AccountMenuPlaceholder compact />);
    expect(html).toMatch(
      /^<span aria-hidden="true" data-slot="account-menu-placeholder"/,
    );
    expect(html).not.toMatch(/<(a|button)\b/);
  });

  it("gives the placeholder the button's slots", () => {
    const compact = renderToStaticMarkup(<AccountMenuPlaceholder compact />);
    expect(compact).toContain('data-slot="account-menu-avatar"');
    expect(compact).not.toContain("account-menu-name");
    expect(renderToStaticMarkup(<AccountMenuPlaceholder />)).toContain(
      'data-slot="account-menu-name"',
    );
  });

  it("posts to the app's own sign-out route", () => {
    expect(render()).toMatch(
      /<form hidden="" action="\/auth\/sign-out" method="post">/,
    );
  });

  it("keeps sign-out one button away without JavaScript", () => {
    expect(render()).toMatch(
      /<noscript><form action="\/auth\/sign-out" method="post"><button type="submit"[^>]*>Sign out<\/button><\/form><\/noscript>/,
    );
    expect(render({ locale: "ru" })).toMatch(/<noscript>.*>Выйти<\/button>/);
  });
});

describe("AccountMenu, open", () => {
  afterEach(() => {
    menu.open = false;
  });

  it("marks every item and separator with a stable slot", () => {
    menu.open = true;
    const html = render();
    expect(html).toContain('data-slot="account-menu-content"');

    const items = tagsWith(html, 'role="menuitem"');
    // the account, purchases and apps links, then sign-out
    expect(items.length).toBeGreaterThan(4);
    for (const item of items) {
      expect(item).toContain('data-slot="account-menu-item"');
    }
    expect(tagsWith(html, 'data-slot="account-menu-item"')).toHaveLength(
      items.length,
    );

    const separators = tagsWith(html, 'role="separator"');
    expect(separators.length).toBeGreaterThan(1);
    for (const separator of separators) {
      expect(separator).toContain('data-slot="account-menu-separator"');
    }
  });

  it("shows the avatar on the button and at the top of the menu", () => {
    menu.open = true;
    expect(tagsWith(render(), 'data-slot="account-menu-avatar"')).toHaveLength(
      2,
    );
  });
});
