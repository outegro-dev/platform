import { Button } from "@outegro/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("title") };
}

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main id="main" className="app-main og-container">
      <section className="notice">
        <p className="og-eyebrow">404</p>
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <div className="notice-actions">
          <Button asChild size="lg">
            <Link href="/">{t("home")}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
