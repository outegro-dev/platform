"use client";

import { Spinner } from "@outegro/ui/spinner";
import {
  BellIcon,
  DevicesIcon,
  EnvelopeSimpleIcon,
  type Icon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOfflineGuard } from "@/components/action-status";

const items = [
  { href: "/account", key: "profile", Icon: UserIcon },
  { href: "/account/security", key: "security", Icon: ShieldCheckIcon },
  { href: "/account/sessions", key: "sessions", Icon: DevicesIcon },
  { href: "/account/inbox", key: "inbox", Icon: EnvelopeSimpleIcon },
  { href: "/account/notifications", key: "notifications", Icon: BellIcon },
] as const;

/** Same 20 px box either way: the spinner replaces the icon while the page loads. */
function NavIcon({ Icon }: { Icon: Icon }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner /> : <Icon aria-hidden="true" />;
}

export function AccountNav() {
  const t = useTranslations("nav");
  const guard = useOfflineGuard();
  const pathname = usePathname();
  return (
    <nav className="account-nav" aria-label={t("sections")}>
      {items.map(({ href, key, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={guard}
          >
            <NavIcon Icon={Icon} />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
