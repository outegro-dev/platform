import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import { getTranslations } from "next-intl/server";
import { BrandHeader } from "@/components/brand-header";
import { authApi } from "@/lib/api";
import { LoginForm } from "./login-form";

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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ continue?: string }>;
}) {
  const t = await getTranslations("login");
  const continueTo = safeRedirectPath(
    (await searchParams).continue,
    "/account",
  );
  const app = await continuingApp(continueTo);
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
          <LoginForm continueTo={continueTo} />
        </section>
      </main>
    </div>
  );
}
