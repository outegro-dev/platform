import { Badge } from "@outegro/ui/badge";
import { Surface } from "@outegro/ui/surface";
import { SealCheckIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { authApi, type Me, withSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ProfileForm } from "./profile-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage() {
  const t = await getTranslations("profile");
  const locale = await getLocale();
  const me = await withSession("/account", (token) =>
    authApi<Me>("/v1/me", { accessToken: token }),
  );
  return (
    <>
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p>{t("lead")}</p>
      </header>
      <Surface className="panel">
        <dl className="facts">
          <div>
            <dt>{t("email")}</dt>
            <dd>
              <span className="mono">{me.email}</span>
              {me.emailVerified && (
                <Badge variant="muted">
                  <SealCheckIcon aria-hidden="true" />
                  {t("verified")}
                </Badge>
              )}
            </dd>
          </div>
          {me.roles.length > 0 && (
            <div>
              <dt>{t("roles")}</dt>
              <dd>
                {me.roles.map((role) => (
                  <Badge key={role}>{role}</Badge>
                ))}
              </dd>
            </div>
          )}
        </dl>
        <p className="muted small">
          {t("memberSince", { date: formatDate(me.createdAt, locale) })}
        </p>
      </Surface>
      <Surface className="panel">
        <ProfileForm
          version={me.version}
          displayName={me.displayName}
          locale={me.locale}
        />
      </Surface>
    </>
  );
}
