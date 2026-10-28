import { Button } from "@outegro/ui/button";
import {
  ArrowClockwiseIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

const reasons = [
  "state_mismatch",
  "missing_code",
  "invalid_grant",
  "unavailable",
] as const;
type Reason = (typeof reasons)[number];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("errorTitle") };
}

/** Where a failed SSO callback lands: what went wrong and a way back. */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth");
  const raw = (await searchParams).reason;
  const reason: Reason = reasons.includes(raw as Reason)
    ? (raw as Reason)
    : "invalid_grant";
  return (
    <main id="main" className="app-main og-container">
      <section className="notice" data-testid="auth-error">
        <span className="notice-icon" aria-hidden="true">
          <WarningCircleIcon />
        </span>
        <h1>{t("errorTitle")}</h1>
        <p>{t(`reasons.${reason}`)}</p>
        <div className="notice-actions">
          <Button asChild size="lg">
            <a href="/auth/sign-in?returnTo=%2F">
              <ArrowClockwiseIcon />
              {t("retry")}
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/">{t("home")}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
