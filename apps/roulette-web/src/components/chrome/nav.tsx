"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const sections = [
  { href: "/", key: "game" },
  { href: "/fair", key: "fair" },
] as const;

/** Roulette and Fairness; the current one is underlined. */
export function MainNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="main-nav" aria-label={t("sections")}>
      {sections.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={pathname === section.href ? "page" : undefined}
        >
          {t(section.key)}
        </Link>
      ))}
    </nav>
  );
}
