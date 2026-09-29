import { AppFooter } from "@/components/app-footer";
import { BrandHeader } from "@/components/brand-header";
import { SignOutForm } from "@/components/sign-out-form";
import { signOut } from "./actions";
import { AccountNav } from "./nav";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="og-container account-shell">
      <BrandHeader actions={<SignOutForm action={signOut} />} />
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
