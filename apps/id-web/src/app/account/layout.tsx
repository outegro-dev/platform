import { Button } from "@outegro/ui/button";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { AppFooter } from "@/components/app-footer";
import { BrandHeader } from "@/components/brand-header";
import { signOut } from "./actions";
import { AccountNav } from "./nav";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("nav");
  return (
    <div className="og-container account-shell">
      <BrandHeader
        actions={
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              <SignOutIcon />
              {t("signOut")}
            </Button>
          </form>
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
