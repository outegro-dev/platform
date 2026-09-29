"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Tabs of a console section (links). The current one is the longest href
 * that prefixes the path, so detail pages keep their list tab highlighted.
 */
export function SectionNav({
  label,
  items,
}: {
  label: string;
  items: { key: string; href: string; label: string }[];
}) {
  const pathname = usePathname();
  const active = items
    .filter(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.key;
  if (items.length < 2) return null;
  return (
    <nav aria-label={label} className="tabs">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="tab"
          aria-current={item.key === active ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
