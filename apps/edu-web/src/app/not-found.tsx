import { Button } from "@outegro/ui/button";
import { StatePanel } from "@outegro/ui/notice";
import { SignpostIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("title") };
}

/** A page or a book that is not there: say so and lead back to the library. */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main id="main" className="app-main og-container">
      <StatePanel
        className="min-h-[52vh]"
        headingLevel={1}
        icon={<SignpostIcon aria-hidden="true" />}
        title={t("title")}
        description={t("body")}
        actions={
          <Button asChild size="lg">
            <Link href="/">{t("home")}</Link>
          </Button>
        }
      />
    </main>
  );
}
