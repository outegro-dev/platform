import { Badge } from "@outegro/ui/badge";
import { Surface } from "@outegro/ui/surface";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { authApi, type SessionItem, withSession } from "@/lib/api";
import { deviceLabel, formatDate } from "@/lib/format";
import {
  RevokeOthersForm,
  RevokeSessionForm,
  SessionActions,
} from "./session-actions";

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
    <SessionActions>
      <PageHead title={t("title")} lead={t("lead")} />
      <ul className="list">
        {items.map((session) => {
          const device =
            deviceLabel(session.userAgent) ??
            session.clientName ??
            t("unknownDevice");
          return (
            <li key={session.id}>
              <Surface className="row">
                <div className="row-main">
                  <p className="row-title">
                    {device}
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
                  <RevokeSessionForm sessionId={session.id} device={device} />
                )}
              </Surface>
            </li>
          );
        })}
      </ul>
      {/* Same height with the button or the note: nothing below moves. */}
      <div className="list-footer">
        {others === 0 ? (
          <p className="muted">{t("empty")}</p>
        ) : (
          <RevokeOthersForm />
        )}
      </div>
    </SessionActions>
  );
}
