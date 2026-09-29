import { Button } from "@outegro/ui/button";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BareShell } from "@/components/bare-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("title") };
}

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <BareShell>
      <section className="notice-page">
        <p className="og-eyebrow">404</p>
        <h1>
          {t("lead")} <span className="og-accent">{t("accent")}</span>
        </h1>
        <p>{t("body")}</p>
        <Button asChild size="lg">
          <a href="/orders">{t("home")}</a>
        </Button>
      </section>
    </BareShell>
  );
}
