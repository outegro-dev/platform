import { Button } from "@outegro/ui/button";
import { Surface } from "@outegro/ui/surface";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { GoogleMark } from "@/components/google-mark";
import { PageHead } from "@/components/page-head";
import { authApi, type Me, withSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { GoogleConfig } from "@/lib/google";
import { unlinkGoogle } from "./actions";

type Identity = { provider: "google"; email: string | null; linkedAt: string };

const notices = new Set([
  "google_failed",
  "google_cancelled",
  "google_unavailable",
  "google_unverified",
  "google_in_use",
  "google_already_linked",
  "google_suspended",
  "google_last_method",
]);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("security");
  return { title: t("title") };
}

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string; unlinked?: string; error?: string }>;
}) {
  const t = await getTranslations("security");
  const tl = await getTranslations("login");
  const locale = await getLocale();
  const params = await searchParams;
  const [me, identities, config] = await withSession(
    "/account/security",
    (token) =>
      Promise.all([
        authApi<Me>("/v1/me", { accessToken: token }),
        authApi<{ items: Identity[] }>("/v1/me/identities", {
          accessToken: token,
        }),
        authApi<GoogleConfig>("/v1/login/google/config").catch(
          (): GoogleConfig => ({
            enabled: false,
            clientId: null,
            redirectUri: null,
          }),
        ),
      ]),
  );
  const google = identities.items.find((item) => item.provider === "google");
  const error = params.error && notices.has(params.error) ? params.error : null;
  const status = error
    ? { tone: "error", text: tl(`googleErrors.${error}`) }
    : params.linked === "google"
      ? { tone: "success", text: t("linked") }
      : params.unlinked === "google"
        ? { tone: "success", text: t("unlinked") }
        : null;

  return (
    <>
      <PageHead title={t("title")} lead={t("lead")} />
      <Surface className="panel">
        <p
          className="channel-status"
          data-tone={status?.tone}
          role={status ? "status" : undefined}
        >
          {status?.text}
        </p>
        <ul className="methods">
          <li className="method">
            <EnvelopeSimpleIcon aria-hidden="true" />
            <div className="method-text">
              <strong>{t("email")}</strong>
              <span>
                {me.email} · {t("emailHint")}
              </span>
            </div>
          </li>
          <li className="method">
            <GoogleMark />
            <div className="method-text">
              <strong>Google</strong>
              <span>
                {google
                  ? t("googleLinked", {
                      email: google.email ?? "—",
                      date: formatDate(google.linkedAt, locale),
                    })
                  : config.enabled
                    ? t("googleNotLinked")
                    : t("googleUnavailable")}
              </span>
            </div>
            {google ? (
              <form action={unlinkGoogle}>
                <Button type="submit" variant="outline" size="sm">
                  {t("unlink")}
                </Button>
              </form>
            ) : (
              config.enabled && (
                <Button asChild variant="outline" size="sm">
                  <a href="/login/google/start?intent=link&continue=%2Faccount%2Fsecurity">
                    {t("link")}
                  </a>
                </Button>
              )
            )}
          </li>
        </ul>
      </Surface>
    </>
  );
}
