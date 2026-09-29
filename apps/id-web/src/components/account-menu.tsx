"use client";

import { AccountMenu } from "@outegro/ui/account-menu";
import type { AccountMenuUser, PlatformUrls } from "@outegro/ui/lib/platform";
import { useLocale } from "next-intl";
import { useOfflineGuard } from "./action-status";

/**
 * The platform's account menu in this app's header. Signing out while
 * offline is explained instead of failing, as everywhere in the account.
 */
export function AccountHeaderMenu({
  user,
  urls,
  returnTo,
  signOut,
}: {
  user: AccountMenuUser;
  urls: PlatformUrls;
  /** This app's address, for "Back to your account" on payments. */
  returnTo: string;
  signOut: () => Promise<void>;
}) {
  const locale = useLocale();
  const guard = useOfflineGuard();
  return (
    <AccountMenu
      user={user}
      current="id"
      urls={urls}
      locale={locale}
      signInHref="/login"
      signOut={signOut}
      onSignOutSubmit={guard}
      returnTo={returnTo}
    />
  );
}
