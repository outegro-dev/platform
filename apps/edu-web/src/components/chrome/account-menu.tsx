"use client";

import { AccountMenu } from "@outegro/ui/account-menu";
import type { AccountMenuUser, PlatformUrls } from "@outegro/ui/lib/platform";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { signOut } from "@/app/actions";
import { signInHref } from "@/lib/routes";
import { useOfflineGuard } from "./action-status";

/**
 * The platform's account menu in the header, or "Sign in" back to the page
 * the reader is on (the header lives in the root layout, which does not
 * re-render between pages, so the path comes from the router). Signing out
 * offline is explained instead of failing.
 */
export function HeaderAccountMenu({
  user,
  urls,
  returnTo,
}: {
  user: AccountMenuUser | null;
  urls: PlatformUrls;
  /** This app's address, for "Back to …" on payments. */
  returnTo: string;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const guard = useOfflineGuard();
  return (
    <AccountMenu
      user={user}
      current="edu"
      urls={urls}
      locale={locale}
      signInHref={signInHref(pathname || "/")}
      signOut={signOut}
      onSignOutSubmit={guard}
      returnTo={returnTo}
    />
  );
}
