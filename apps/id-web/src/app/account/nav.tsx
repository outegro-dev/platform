"use client";

import {
  BellIcon,
  DevicesIcon,
  EnvelopeSimpleIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const items = [
  { href: "/account", key: "profile", Icon: UserIcon },
  { href: "/account/sessions", key: "sessions", Icon: DevicesIcon },
  { href: "/account/inbox", key: "inbox", Icon: EnvelopeSimpleIcon },
  { href: "/account/notifications", key: "notifications", Icon: BellIcon },
] as const;

export function AccountNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="account-nav" aria-label={t("sections")}>
      {items.map(({ href, key, Icon }) => {
        const active = pathname === href;
        return (
          <a key={href} href={href} aria-current={active ? "page" : undefined}>
            <Icon aria-hidden="true" />
            {t(key)}
          </a>
        );
      })}
    </nav>
  );
}
