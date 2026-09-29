import { productionPlatformUrls } from "@outegro/ui/lib/platform";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountMenu, type AccountMenuProps } from "./account-menu";

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

describe("AccountMenu", () => {
  it("is a clear Sign in link when nobody is signed in", () => {
    const html = render({ user: null });
    expect(html).toMatch(/^<a [^>]*href="\/auth\/sign-in\?returnTo=%2F"/);
    expect(html).toContain(">Sign in</a>");
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(render({ user: null, locale: "ru" })).toContain(">Войти</a>");
  });

  it("is a menu button named after the signed-in person", () => {
    const html = render();
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Nick Lukashik, account and apps"');
    expect(html).toContain(">NL</span>");
    expect(html).toContain('data-slot="account-menu-name"');
  });

  it("names the button in the host app's language", () => {
    expect(render({ locale: "ru" })).toContain(
      'aria-label="Nick Lukashik, аккаунт и приложения"',
    );
    expect(render({ user: {}, locale: "ru" })).toContain(
      'aria-label="Ваш аккаунт, аккаунт и приложения"',
    );
  });

  it("keeps only the avatar when compact", () => {
    expect(render({ compact: true })).not.toContain("account-menu-name");
  });

  it("posts to the app's own sign-out route", () => {
    expect(render()).toMatch(
      /<form hidden="" action="\/auth\/sign-out" method="post">/,
    );
  });
});
