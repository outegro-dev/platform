"use client";

import {
  ArrowsClockwiseIcon,
  ReceiptIcon,
  StorefrontIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const items = [
  { href: "/orders", key: "orders", Icon: ReceiptIcon },
  { href: "/subscriptions", key: "subscriptions", Icon: ArrowsClockwiseIcon },
  { href: "/catalog", key: "catalog", Icon: StorefrontIcon },
] as const;

/** The three sections, always visible (a segmented bar on phones). */
export function AppNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="app-nav og-glass" aria-label={t("sections")}>
      {items.map(({ href, key, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" weight={active ? "fill" : "regular"} />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
