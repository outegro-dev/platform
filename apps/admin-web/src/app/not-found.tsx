import { Button } from "@outegro/ui/button";
import { CompassIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthFrame } from "@/components/shell/auth-frame";
import { StateView } from "@/components/ui/states";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("title") };
}

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <AuthFrame>
      <StateView
        kind="empty"
        size="page"
        icon={<CompassIcon />}
        title={t("title")}
        body={t("body")}
        actions={
          <Button asChild size="md">
            <Link href="/">{t("home")}</Link>
          </Button>
        }
      />
    </AuthFrame>
  );
}
