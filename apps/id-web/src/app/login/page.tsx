import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import { Button } from "@outegro/ui/button";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppFooter } from "@/components/app-footer";
import { BrandHeader } from "@/components/brand-header";
import { GoogleMark } from "@/components/google-mark";
import { authApi } from "@/lib/api";
import type { GoogleConfig } from "@/lib/google";
import { LoginForm } from "./login-form";

const googleErrors = new Set([
  "google_failed",
  "google_cancelled",
  "google_unavailable",
  "google_link_required",
  "google_unverified",
  "google_suspended",
]);

/** Google sign-in is offered only when auth-backend has it configured. */
async function googleEnabled() {
  try {
    return (await authApi<GoogleConfig>("/v1/login/google/config")).enabled;
  } catch {
    return false;
  }
}

/** Name of the app the user is signing in to, when coming from /authorize. */
async function continuingApp(continueTo: string) {
  if (!continueTo.startsWith("/authorize?")) return null;
  const params = new URLSearchParams(continueTo.slice("/authorize?".length));
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (!clientId || !redirectUri) return null;
  try {
    const client = await authApi<{ name: string }>(
      `/v1/oauth/clients/${encodeURIComponent(clientId)}?redirectUri=${encodeURIComponent(redirectUri)}`,
    );
    return client.name;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("title") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ continue?: string; error?: string }>;
}) {
  const t = await getTranslations("login");
  const params = await searchParams;
  const continueTo = safeRedirectPath(params.continue, "/account");
  const [app, google] = await Promise.all([
    continuingApp(continueTo),
    googleEnabled(),
  ]);
  const error =
    params.error && googleErrors.has(params.error) ? params.error : null;
  return (
    <div className="login-shell og-container">
      <BrandHeader />
      <main className="login-main" id="main">
        <section className="login-intro">
          <p className="og-eyebrow">{t("eyebrow")}</p>
          <h1>
            {t("title")} <span className="og-accent">{t("titleAccent")}</span>
          </h1>
          <p className="login-lead">{t("lead")}</p>
        </section>
        <section
          className="login-card og-glass"
          aria-labelledby="login-card-title"
        >
          <h2 id="login-card-title" className="sr-only">
            {t("title")}
          </h2>
          {app && (
            <p className="og-eyebrow login-app">{t("continuingTo", { app })}</p>
          )}
          {error && (
            <p className="login-notice" role="alert">
              {t(`googleErrors.${error}`)}
            </p>
          )}
          <LoginForm continueTo={continueTo} />
          {google && (
            <div className="login-alt">
              <p className="login-divider">
                <span>{t("or")}</span>
              </p>
              <Button asChild variant="outline" className="login-google">
                <a
                  href={`/login/google/start?continue=${encodeURIComponent(continueTo)}`}
                >
                  <GoogleMark />
                  {t("google")}
                </a>
              </Button>
            </div>
          )}
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
