import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { Button } from "@outegro/ui/button";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { AppFooter } from "@/components/app-footer";
import { BrandHeader } from "@/components/brand-header";
import { accessToken, authApi } from "@/lib/api";

const paramsSchema = z.object({
  response_type: z.literal("code").optional(),
  client_id: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
  redirect_uri: z.url().max(500),
  state: z.string().min(16).max(256),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
});

/**
 * SSO entry for platform apps (ID-04). Nothing is redirected to an
 * unregistered address: invalid requests end on this page.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const parsed = paramsSchema.safeParse(
    Object.fromEntries(
      Object.entries(raw).filter(([, v]) => typeof v === "string"),
    ),
  );
  if (!parsed.success) return <Invalid />;
  const p = parsed.data;

  try {
    await authApi(
      `/v1/oauth/clients/${p.client_id}?redirectUri=${encodeURIComponent(p.redirect_uri)}`,
    );
  } catch (error) {
    // An outage is not a bad link: the error page offers a retry.
    if (error instanceof BackendUnavailable) throw error;
    return <Invalid />;
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
  if (!token) redirect(`/login?continue=${encodeURIComponent(self)}`);

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
