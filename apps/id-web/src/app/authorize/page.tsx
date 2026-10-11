import { BackendError } from "@outegro/bff/backend";
import { Button } from "@outegro/ui/button";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppFooter } from "@/components/app-footer";
import { BrandHeader } from "@/components/brand-header";
import { accessToken, authApi } from "@/lib/api";
import {
  parseAuthorizeRequest,
  registryFailure,
  type SilentError,
  silentAnswer,
  silentError,
} from "@/lib/authorize";
import { platformUrls } from "@/lib/env";

/**
 * SSO entry for platform apps (ID-04). Nothing is redirected to an
 * unregistered address: invalid requests end on this page.
 *
 * `prompt=none` is an app's silent sign-in: the visitor did not ask to sign
 * in, so once the redirect URI is known to be the app's, no page is shown.
 * With a session here the code is issued as usual; without one, or when
 * Identity refuses or cannot answer, the app's callback gets an OIDC error
 * (`login_required`, ...) and the visitor stays there, signed out.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseAuthorizeRequest(await searchParams);
  if (!p) return <Invalid />;
  const { silent } = p;
  const answer = (error: SilentError) =>
    redirect(silentAnswer(p.redirect_uri, p.state, error));

  try {
    await authApi(
      `/v1/oauth/clients/${p.client_id}?redirectUri=${encodeURIComponent(p.redirect_uri)}`,
    );
  } catch (error) {
    const failure = registryFailure(error, p, platformUrls);
    if (failure === "invalid") return <Invalid />;
    if (failure === "answer") answer("temporarily_unavailable");
    // An outage is not a bad link: the error page offers a retry.
    throw error;
  }

  const query = new URLSearchParams({
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    state: p.state,
    code_challenge: p.code_challenge,
    code_challenge_method: "S256",
  });
  const self = `/authorize?${query}`;
  const token = await accessToken();
  if (!token) {
    if (silent) answer("login_required");
    redirect(`/login?continue=${encodeURIComponent(self)}`);
  }

  let code: string;
  try {
    ({ code } = await authApi<{ code: string }>("/v1/oauth/authorize", {
      method: "POST",
      accessToken: token,
      body: {
        clientId: p.client_id,
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        codeChallengeMethod: "S256",
      },
    }));
  } catch (error) {
    if (silent) answer(silentError(error));
    if (error instanceof BackendError && error.status === 401) {
      redirect(`/login?continue=${encodeURIComponent(self)}`);
    }
    if (error instanceof BackendError) return <Invalid />;
    throw error;
  }
  const target = new URL(p.redirect_uri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", p.state);
  redirect(target.toString());
}

async function Invalid() {
  const t = await getTranslations("authorize");
  return (
    <div className="login-shell og-container">
      <BrandHeader />
      <main className="notice" id="main">
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <Button asChild size="lg">
          <a href="/account">{t("back")}</a>
        </Button>
      </main>
      <AppFooter />
    </div>
  );
}
