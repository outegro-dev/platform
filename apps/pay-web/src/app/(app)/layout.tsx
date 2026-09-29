import { getTranslations } from "next-intl/server";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";

/** Signed-in shell: header with sections, the page, links. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("nav");
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <AppHeader />
      <main id="main" className="app-main og-container" tabIndex={-1}>
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
