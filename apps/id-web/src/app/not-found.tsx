import { Button } from "@outegro/ui/button";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppFooter } from "@/components/app-footer";
import { BrandHeader } from "@/components/brand-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("title") };
}

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="login-shell og-container">
      <BrandHeader />
      <main className="notice" id="main">
        <p className="og-eyebrow">404</p>
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <Button asChild size="lg">
          <a href="/account">{t("home")}</a>
        </Button>
      </main>
      <AppFooter />
    </div>
  );
}
