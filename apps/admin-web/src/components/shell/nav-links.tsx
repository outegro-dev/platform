"use client";

import {
  ArrowUpRightIcon,
  BellIcon,
  BoatIcon,
  ChartLineIcon,
  CreditCardIcon,
  type Icon,
  ScrollIcon,
  SquaresFourIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";
import { activeNav, externalNav, type NavKey } from "@/lib/nav";

const icons: Record<NavKey, Icon> = {
  dashboard: SquaresFourIcon,
  users: UsersIcon,
  notifications: BellIcon,
  payments: CreditCardIcon,
  battleship: BoatIcon,
  audit: ScrollIcon,
  monitoring: ChartLineIcon,
};

export type NavGroup = {
  key: string;
  label: string;
  items: { key: NavKey; href: string; label: string }[];
};

/** Lets the phone navigation sheet close itself after a link is followed. */
export const NavigateContext = createContext<(() => void) | null>(null);

export function NavLinks({
  groups,
  label,
}: {
  groups: NavGroup[];
  label: string;
}) {
  const pathname = usePathname();
  const active = activeNav(pathname);
  const onNavigate = useContext(NavigateContext);
  return (
    <nav className="nav" aria-label={label}>
      {groups.map((group) => (
        <div key={group.key} className="nav-group">
          <p className="nav-group-label" id={`nav-${group.key}`}>
            {group.label}
          </p>
          <ul aria-labelledby={`nav-${group.key}`}>
            {group.items.map((item) => {
              const Glyph = icons[item.key];
              // Monitoring is another app on this host (Grafana): a plain
              // link in the same tab, no client routing or prefetch.
              if (externalNav.has(item.key)) {
                return (
                  <li key={item.key}>
                    <a
                      href={item.href}
                      className="nav-link"
                      onClick={() => onNavigate?.()}
                    >
                      <Glyph aria-hidden="true" />
                      {item.label}
                      <ArrowUpRightIcon
                        aria-hidden="true"
                        className="nav-link-out"
                      />
                    </a>
                  </li>
                );
              }
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="nav-link"
                    aria-current={active === item.key ? "page" : undefined}
                    onClick={() => onNavigate?.()}
                  >
                    <Glyph
                      aria-hidden="true"
                      weight={active === item.key ? "fill" : "regular"}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
