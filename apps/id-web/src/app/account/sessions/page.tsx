import { Badge } from "@outegro/ui/badge";
import { Button } from "@outegro/ui/button";
import { Surface } from "@outegro/ui/surface";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { authApi, type SessionItem, withSession } from "@/lib/api";
import { deviceLabel, formatDate } from "@/lib/format";
import { revokeSession } from "../actions";
import { RevokeOthers } from "./revoke-others";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sessions");
  return { title: t("title") };
}

export default async function SessionsPage() {
  const t = await getTranslations("sessions");
  const locale = await getLocale();
  const { items } = await withSession("/account/sessions", (token) =>
    authApi<{ items: SessionItem[] }>("/v1/me/sessions", {
      accessToken: token,
    }),
  );
  const others = items.filter((session) => !session.current).length;
  return (
    <>
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p>{t("lead")}</p>
      </header>
      <ul className="list">
        {items.map((session) => (
          <li key={session.id}>
            <Surface className="row">
              <div className="row-main">
                <p className="row-title">
                  {deviceLabel(session.userAgent) ??
                    session.clientName ??
                    t("unknownDevice")}
                  {session.current && (
                    <Badge variant="solid">{t("current")}</Badge>
                  )}
                </p>
                <p className="muted small">
                  {t(`signedInWith.${session.authMethod}`)}
                  {session.clientName && ` · ${session.clientName}`}
                  {session.ip && (
                    <>
                      {" · "}
                      <span className="mono">{session.ip}</span>
                    </>
                  )}
                </p>
                <p className="muted small">
                  {t("lastActive", {
                    date: formatDate(session.lastActiveAt, locale),
                  })}
                  {" · "}
                  {t("started", {
                    date: formatDate(session.createdAt, locale),
                  })}
                </p>
              </div>
              {!session.current && (
                <form action={revokeSession}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("revoke")}
                  </Button>
                </form>
              )}
            </Surface>
          </li>
        ))}
      </ul>
      {others === 0 ? <p className="muted">{t("empty")}</p> : <RevokeOthers />}
    </>
  );
}
