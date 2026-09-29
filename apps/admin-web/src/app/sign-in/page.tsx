import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import { ACCESS_COOKIE, secondsLeft } from "@outegro/bff/session";
import { Button } from "@outegro/ui/button";
import { Surface } from "@outegro/ui/surface";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  FingerprintIcon,
  ScrollIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthFrame } from "@/components/shell/auth-frame";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signIn");
  return { title: t("metaTitle") };
}

const errors = [
  "state_mismatch",
  "missing_code",
  "invalid_grant",
  "unavailable",
];

/**
 * Where signed-out operators land: after sign-out, after the idle timer,
 * or when the SSO round trip failed. Signing in is one link to
 * id.outegro.dev (a navigation, so the CSP form-action stays 'self').
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;
  const returnTo = safeRedirectPath(one("returnTo"), "/");
  if (secondsLeft((await cookies()).get(ACCESS_COOKIE)?.value) > 30) {
    redirect(returnTo);
  }
  const t = await getTranslations("signIn");
  const error = one("error");
  const notice =
    error && errors.includes(error)
      ? { tone: "bad" as const, text: t(`errors.${error}`) }
      : one("reason") === "idle"
        ? { tone: "warn" as const, text: t("idle") }
        : one("signedOut")
          ? { tone: "ok" as const, text: t("signedOut") }
          : null;

  return (
    <AuthFrame>
      <div className="auth-main">
        <section className="auth-intro" aria-labelledby="sign-in-title">
          <p className="og-eyebrow">{t("eyebrow")}</p>
          <h1 id="sign-in-title">
            {t("title")} <span className="og-accent">{t("titleAccent")}</span>
          </h1>
          <p className="auth-lead">{t("lead")}</p>
        </section>
        <Surface variant="glass" className="auth-card">
          <h2>{t("cardTitle")}</h2>
          <div className="form-status" role="status" aria-live="polite">
            {notice && (
              <p className="notice" data-tone={notice.tone}>
                {notice.tone === "ok" ? (
                  <CheckCircleIcon aria-hidden="true" />
                ) : notice.tone === "warn" ? (
                  <ClockCountdownIcon aria-hidden="true" />
                ) : (
                  <WarningCircleIcon aria-hidden="true" />
                )}
                <span>{notice.text}</span>
              </p>
            )}
          </div>
          <Button asChild size="lg">
            <a href={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
              <FingerprintIcon aria-hidden="true" />
              {t("cta")}
              <ArrowRightIcon aria-hidden="true" />
            </a>
          </Button>
          <ul className="auth-points">
            <li>
              <ShieldCheckIcon aria-hidden="true" />
              {t("pointRoles")}
            </li>
            <li>
              <ScrollIcon aria-hidden="true" />
              {t("pointAudit")}
            </li>
            <li>
              <ClockCountdownIcon aria-hidden="true" />
              {t("pointIdle")}
            </li>
          </ul>
        </Surface>
      </div>
    </AuthFrame>
  );
}
