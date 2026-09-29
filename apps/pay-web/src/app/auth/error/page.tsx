import { Button } from "@outegro/ui/button";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BareShell } from "@/components/bare-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("errorMetaTitle") };
}

const reasons = [
  "state_mismatch",
  "missing_code",
  "invalid_grant",
  "unavailable",
];

/** Sign-in through id.outegro.dev did not complete; one click starts over. */
export default async function SignInError({
  searchParams,
}: PageProps<"/auth/error">) {
  const { reason } = await searchParams;
  const t = await getTranslations("auth");
  const key =
    typeof reason === "string" && reasons.includes(reason) ? reason : "unknown";
  return (
    <BareShell>
      <section className="notice-page" role="alert">
        <p className="og-eyebrow">SSO</p>
        <h1>
          {t("errorTitle")}{" "}
          <span className="og-accent">{t("errorAccent")}</span>
        </h1>
        <p>{t(`errorBody.${key}`)}</p>
        <Button asChild size="lg">
          <a href="/auth/sign-in?returnTo=%2Forders">
            {t("errorAction")}
            <ArrowRightIcon aria-hidden="true" />
          </a>
        </Button>
      </section>
    </BareShell>
  );
}
