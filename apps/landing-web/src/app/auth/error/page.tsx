import { Button } from "@outegro/ui/button";
import { StatePanel } from "@outegro/ui/notice";
import {
  ArrowClockwiseIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata, Viewport } from "next";
import { getTranslations } from "next-intl/server";
import { unlisted } from "@/lib/metadata";

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
  const t = await getTranslations("auth.meta");
  return unlisted({ title: t("title") });
}

// the main page's cream paper, which this page is printed on too
export const viewport: Viewport = { themeColor: "#f6eede" };

/** Where a failed sign-in the visitor asked for lands: what went wrong and a way back. */
export default async function AuthErrorPage({
  searchParams,
}: PageProps<"/auth/error">) {
  const t = await getTranslations("auth");
  const reason = reasonOf((await searchParams).reason);
  return (
    <main
      id="main"
      className="auth-error og-container grid min-h-svh place-items-center"
    >
      <StatePanel
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
              <a href="/">{t("home")}</a>
            </Button>
          </>
        }
      />
    </main>
  );
}
