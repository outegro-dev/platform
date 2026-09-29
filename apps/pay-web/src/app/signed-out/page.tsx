import { Button } from "@outegro/ui/button";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BareShell } from "@/components/bare-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signedOutMetaTitle") };
}

/**
 * After sign-out. Public on purpose: any signed-in page would send the
 * visitor through SSO and straight back in.
 */
export default async function SignedOut() {
  const t = await getTranslations("auth");
  return (
    <BareShell>
      <section className="notice-page">
        <h1>
          {t("signedOutTitle")}{" "}
          <span className="og-accent">{t("signedOutAccent")}</span>
        </h1>
        <p>{t("signedOutBody")}</p>
        <Button asChild size="lg">
          <a href="/auth/sign-in?returnTo=%2Forders">
            {t("signIn")}
            <ArrowRightIcon aria-hidden="true" />
          </a>
        </Button>
      </section>
    </BareShell>
  );
}
