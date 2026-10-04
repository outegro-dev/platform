import { Button } from "@outegro/ui/button";
import { StatePanel } from "@outegro/ui/notice";
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
type Reason = (typeof reasons)[number] | "unknown";

const reasonOf = (raw: unknown): Reason =>
  reasons.find((reason) => reason === raw) ?? "unknown";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("errorTitle") };
}

/** Where a failed SSO callback lands: what went wrong and a way back. */
export default async function AuthErrorPage({
  searchParams,
}: PageProps<"/auth/error">) {
  const t = await getTranslations("auth");
  const reason = reasonOf((await searchParams).reason);
  return (
    <main id="main" className="app-main og-container">
      <StatePanel
        className="min-h-[52vh]"
        tone="danger"
        live="assertive"
        headingLevel={1}
        data-testid="auth-error"
        icon={<WarningCircleIcon aria-hidden="true" />}
        title={t("errorTitle")}
        description={t(`reasons.${reason}`)}
        actions={
          <>
            <Button asChild size="lg">
              <a href="/auth/sign-in?returnTo=%2F">
                <ArrowClockwiseIcon aria-hidden="true" />
                {t("retry")}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/">{t("home")}</Link>
            </Button>
          </>
        }
      />
    </main>
  );
}
