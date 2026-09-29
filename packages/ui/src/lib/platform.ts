import { hasPlatformRole } from "@outegro/contracts/access";

/*
 * The outegro.dev platform as its frontends link to one another: public
 * addresses of the apps, the pages other apps open, and the words of the
 * account menu in English and Russian. Plain data and functions (no React,
 * no fetching), so server components, client components and tests share
 * them. Each app passes its own configuration in; nothing here reads env.
 */

export const platformApps = ["battleship", "id", "pay", "admin"] as const;
export type PlatformApp = (typeof platformApps)[number];

/** Public origins of the apps and of the portfolio site (`site`). */
export type PlatformUrls = Record<PlatformApp | "site", string>;

/** Production addresses; every app overrides them from its configuration. */
export const productionPlatformUrls: PlatformUrls = {
  site: "https://outegro.dev",
  id: "https://id.outegro.dev",
  pay: "https://pay.outegro.dev",
  battleship: "https://battleship.outegro.dev",
  admin: "https://admin.outegro.dev",
};

/** Pages that other apps link to. */
export const platformPages = {
  account: { app: "id", path: "/account" },
  security: { app: "id", path: "/account/security" },
  notifications: { app: "id", path: "/account/notifications" },
  purchases: { app: "pay", path: "/orders" },
  subscriptions: { app: "pay", path: "/subscriptions" },
} as const satisfies Record<string, { app: PlatformApp; path: string }>;
export type PlatformPage = keyof typeof platformPages;

/** Where each app starts. */
const homePaths: Record<PlatformApp | "site", string> = {
  battleship: "/",
  id: "/account",
  pay: "/orders",
  admin: "/",
  site: "/",
};

/**
 * Query parameter of pay.outegro.dev pages naming the page to go back to.
 * pay-web accepts it only for origins on its allow-list of platform apps.
 */
export const RETURN_PARAM = "return";

type LinkOptions = {
  /** The app the link is rendered in: its own pages stay relative. */
  from?: PlatformApp;
  /** Absolute URL pay.outegro.dev offers as the way back (see RETURN_PARAM). */
  returnTo?: string | null;
};

/**
 * A link to `path` of `app`: relative inside the app itself, absolute on its
 * configured origin otherwise. Links to payments carry `returnTo`.
 */
export function platformHref(
  urls: PlatformUrls,
  app: PlatformApp | "site",
  path = homePaths[app],
  { from, returnTo }: LinkOptions = {},
): string {
  const href = app === from ? path : `${urls[app].replace(/\/+$/, "")}${path}`;
  if (app !== "pay" || from === "pay" || !returnTo) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${RETURN_PARAM}=${encodeURIComponent(returnTo)}`;
}

/** A page of the platform by name, e.g. `pageHref(urls, "subscriptions")`. */
export function pageHref(
  urls: PlatformUrls,
  page: PlatformPage,
  options: LinkOptions = {},
): string {
  const { app, path } = platformPages[page];
  return platformHref(urls, app, path, options);
}

/** "https://pay.outegro.dev" → "pay.outegro.dev"; null for a malformed URL. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * Up to two letters for an avatar: first letters of the first two words of
 * a name ("Nick Lukashik" → "NL"), the first letter of an email.
 */
export function initialsOf(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  if (!text) return "";
  const source = text.includes("@")
    ? [text.split("@")[0] ?? ""]
    : text.split(/\s+/);
  const letters = source
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return letters.toLocaleUpperCase();
}

// ─── Account menu ─────────────────────────────────────────────────────────

export type AccountMenuMessages = {
  /** Second half of the trigger's accessible name: "<who>, account and apps". */
  menu: string;
  /** The trigger's name when nobody could be named. */
  menuTitle: string;
  signIn: string;
  signOut: string;
  signingOut: string;
  /** Title when Identity did not say who it is (it was unreachable). */
  unknownUser: string;
  oneSignIn: string;
  yourAccount: string;
  profile: string;
  security: string;
  notifications: string;
  purchases: string;
  apps: string;
  appNames: Record<PlatformApp, string>;
  portfolio: string;
  /** Read after the app the menu is shown in. */
  current: string;
};

export const accountMenuMessages = {
  en: {
    menu: "account and apps",
    menuTitle: "Account and apps",
    signIn: "Sign in",
    signOut: "Sign out",
    signingOut: "Signing out…",
    unknownUser: "Your account",
    oneSignIn: "One sign-in for every outegro app",
    yourAccount: "Your account",
    profile: "Profile",
    security: "Security",
    notifications: "Notifications",
    purchases: "Purchases & subscriptions",
    apps: "Apps",
    appNames: {
      battleship: "Battleship",
      id: "Account",
      pay: "Payments",
      admin: "Admin console",
    },
    portfolio: "Portfolio",
    current: "you are here",
  },
  ru: {
    menu: "аккаунт и приложения",
    menuTitle: "Аккаунт и приложения",
    signIn: "Войти",
    signOut: "Выйти",
    signingOut: "Выходим…",
    unknownUser: "Ваш аккаунт",
    oneSignIn: "Один вход во все приложения outegro",
    yourAccount: "Ваш аккаунт",
    profile: "Профиль",
    security: "Безопасность",
    notifications: "Уведомления",
    purchases: "Покупки и подписки",
    apps: "Приложения",
    appNames: {
      battleship: "Морской бой",
      id: "Аккаунт",
      pay: "Платежи",
      admin: "Админка",
    },
    portfolio: "Портфолио",
    current: "вы здесь",
  },
} as const satisfies Record<"en" | "ru", AccountMenuMessages>;

/** The host app's locale; anything but Russian reads English. */
export function accountMenuMessagesFor(
  locale: string | null | undefined,
): AccountMenuMessages {
  return locale === "ru" ? accountMenuMessages.ru : accountMenuMessages.en;
}

/** Who is signed in, as the host app learned it from Identity (`/v1/me`). */
export type AccountMenuUser = {
  /** Display name; the email stands in when it is empty. */
  name?: string | null;
  email?: string | null;
  /** Platform roles: any of them adds the admin console to Apps. */
  roles?: readonly string[] | null;
};

export type AccountMenuIcon =
  | "profile"
  | "security"
  | "notifications"
  | "purchases"
  | PlatformApp
  | "site";

export type AccountMenuLink = {
  key: string;
  label: string;
  href: string;
  icon: AccountMenuIcon;
  /** Shown under the label: where the link leads. */
  host: string | null;
  /** The app the menu is shown in. */
  current: boolean;
};

export type AccountMenuGroup = {
  key: "account" | "apps" | "site";
  label: string | null;
  items: AccountMenuLink[];
};

export type AccountMenuModel = {
  messages: AccountMenuMessages;
  person: {
    title: string;
    subtitle: string | null;
    initials: string;
    /** The menu button's accessible name. */
    label: string;
  };
  groups: AccountMenuGroup[];
};

export type AccountMenuInput = {
  user: AccountMenuUser;
  urls: PlatformUrls;
  /** The app rendering the menu. */
  current: PlatformApp;
  locale: string | null | undefined;
  /** Absolute URL of this app for "Back to …" on pay.outegro.dev. */
  returnTo?: string | null;
};

/** Everything the signed-in menu shows, decided without React. */
export function accountMenuModel({
  user,
  urls,
  current,
  locale,
  returnTo,
}: AccountMenuInput): AccountMenuModel {
  const messages = accountMenuMessagesFor(locale);
  const name = user.name?.trim() || null;
  const email = user.email?.trim() || null;
  const link = { from: current, returnTo };
  const page = (
    key: "profile" | "security" | "notifications" | "purchases",
    target: PlatformPage,
    label: string,
  ): AccountMenuLink => ({
    key,
    label,
    href: pageHref(urls, target, link),
    icon: key,
    host: null,
    current: false,
  });
  const app = (key: PlatformApp): AccountMenuLink => ({
    key: `app-${key}`,
    label: messages.appNames[key],
    href: platformHref(urls, key, undefined, link),
    icon: key,
    host: hostOf(urls[key]),
    current: key === current,
  });
  const apps: PlatformApp[] = ["battleship", "id", "pay"];
  if (hasPlatformRole(user.roles)) apps.push("admin");
  const who = name ?? email;
  return {
    messages,
    person: {
      title: who ?? messages.unknownUser,
      subtitle: name && email ? email : null,
      initials: initialsOf(who),
      label: who ? `${who}, ${messages.menu}` : messages.menuTitle,
    },
    groups: [
      {
        key: "account",
        label: messages.yourAccount,
        items: [
          page("profile", "account", messages.profile),
          page("security", "security", messages.security),
          page("notifications", "notifications", messages.notifications),
          page("purchases", "purchases", messages.purchases),
        ],
      },
      { key: "apps", label: messages.apps, items: apps.map(app) },
      {
        key: "site",
        label: null,
        items: [
          {
            key: "site",
            label: messages.portfolio,
            href: platformHref(urls, "site"),
            icon: "site",
            host: hostOf(urls.site),
            current: false,
          },
        ],
      },
    ],
  };
}
