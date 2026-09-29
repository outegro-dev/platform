import { AccountMenuPlaceholder } from "@outegro/ui/account-menu";
import { pageHref } from "@outegro/ui/lib/platform";
import { Suspense } from "react";
import { AccountHeaderMenu } from "@/components/account-menu";
import { AppFooter } from "@/components/app-footer";
import { BrandHeader } from "@/components/brand-header";
import { loadMe } from "@/lib/api";
import { platformUrls } from "@/lib/env";
import { signOut } from "./actions";
import { AccountNav } from "./nav";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="og-container account-shell">
      <BrandHeader
        actions={
          // Same box while Identity answers, so nothing moves.
          <Suspense fallback={<AccountMenuPlaceholder />}>
            <HeaderMenu />
          </Suspense>
        }
      />
      <div className="account-grid">
        <AccountNav />
        <main id="main" className="account-main">
          {children}
        </main>
      </div>
      <AppFooter />
    </div>
  );
}

/** Who is signed in, the account's pages, the other apps and sign-out. */
async function HeaderMenu() {
  const me = await loadMe();
  return (
    <AccountHeaderMenu
      user={{ name: me?.displayName, email: me?.email, roles: me?.roles }}
      urls={platformUrls}
      returnTo={pageHref(platformUrls, "account")}
      signOut={signOut}
    />
  );
}
