import { Button } from "@outegro/ui/button";
import { StatePanel } from "@outegro/ui/notice";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthFrame } from "@/components/ui/states";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signedOutTitle") };
}

/** After sign-out: no silent sign-in, one button back in. */
export default async function SignedOutPage() {
  const t = await getTranslations("auth");
  return (
    <AuthFrame>
      <StatePanel
        className="min-h-[56vh]"
        headingLevel={1}
        icon={<DoorOpenIcon aria-hidden="true" />}
        title={t("signedOutTitle")}
        description={t("signedOutBody")}
        actions={
          <Button asChild size="lg">
            <a href="/auth/sign-in?returnTo=%2F">{t("signIn")}</a>
          </Button>
        }
      />
    </AuthFrame>
  );
}
