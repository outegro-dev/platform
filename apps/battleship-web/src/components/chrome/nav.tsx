"use client";

import {
  AnchorSimpleIcon,
  StorefrontIcon,
  TrophyIcon,
  UserIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const items = [
  {
    href: "/",
    key: "play",
    Icon: AnchorSimpleIcon,
    match: ["/", "/play", "/room"],
  },
  {
    href: "/leaderboard",
    key: "leaderboard",
    Icon: TrophyIcon,
    match: ["/leaderboard"],
  },
  { href: "/shop", key: "shop", Icon: StorefrontIcon, match: ["/shop"] },
  {
    href: "/profile",
    key: "profile",
    Icon: UserIcon,
    match: ["/profile", "/replay"],
  },
] as const;

function isCurrent(pathname: string, match: readonly string[]) {
  return match.some((prefix) =>
    prefix === "/"
      ? pathname === "/"
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Section navigation: a glass pill in the header on wide screens. */
export function MainNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="main-nav og-glass" aria-label={t("sections")}>
      {items.map(({ href, key, match }) => (
        <Link
          key={href}
          href={href}
          aria-current={isCurrent(pathname, match) ? "page" : undefined}
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}

/** The same sections as a bottom tab bar on phones. */
export function TabBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="tab-bar og-glass" aria-label={t("sections")}>
      {items.map(({ href, key, Icon, match }) => {
        const current = isCurrent(pathname, match);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
          >
            <Icon weight={current ? "fill" : "regular"} aria-hidden="true" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
