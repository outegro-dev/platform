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

/** A page or an application that is not there: say so and lead back to the board. */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main id="main" className="page">
      <StatePanel
        className="min-h-[60vh]"
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
