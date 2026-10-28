"use client";

import {
  FlowArrowIcon,
  IdentificationCardIcon,
  KanbanIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, use } from "react";
import { type SectionKey, sectionOf, sections } from "@/lib/routes";

const icons: Record<SectionKey, typeof TrayIcon> = {
  inbox: TrayIcon,
  board: KanbanIcon,
  pipeline: FlowArrowIcon,
  profile: IdentificationCardIcon,
};

/** Closes the phone menu sheet when one of its links is followed. */
export const NavigateContext = createContext<() => void>(() => {});

/**
 * The four sections: down the sidebar on a desktop, along the bottom on a
 * phone or tablet. The current one is marked with aria-current.
 */
export function NavLinks({
  variant,
  inboxCount,
}: {
  variant: "side" | "tabbar";
  inboxCount: number | null;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const current = sectionOf(pathname ?? "/");
  const navigated = use(NavigateContext);
  return (
    <ul className={`nav-list nav-list-${variant}`}>
      {sections.map(({ key, href }) => {
        const Icon = icons[key];
        const count = key === "inbox" && inboxCount ? inboxCount : null;
        return (
          <li key={key}>
            <Link
              href={href}
              className="nav-link"
              aria-current={current === key ? "page" : undefined}
              onClick={navigated}
            >
              <span className="nav-icon">
                <Icon
                  aria-hidden="true"
                  weight={current === key ? "fill" : "regular"}
                />
                {count && variant === "tabbar" ? (
                  <span className="nav-dot" aria-hidden="true" />
                ) : null}
              </span>
              <span className="nav-label">{t(key)}</span>
              {count ? (
                <span className="nav-count">
                  <span aria-hidden="true">{count}</span>
                  <span className="sr-only">
                    {`, ${t("inboxCount", { count })}`}
                  </span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
