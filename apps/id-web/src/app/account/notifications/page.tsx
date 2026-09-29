import { Surface } from "@outegro/ui/surface";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { notificationsApi, type Preferences, withSession } from "@/lib/api";
import { PreferencesForm } from "./preferences-form";
import type { TelegramStatus } from "./telegram-actions";
import { TelegramCard } from "./telegram-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("preferences");
  return { title: t("title") };
}

export default async function NotificationsPage() {
  const t = await getTranslations("preferences");
  const [preferences, telegram] = await withSession(
    "/account/notifications",
    (token) =>
      Promise.all([
        notificationsApi<Preferences>("/v1/me/notification-preferences", {
          accessToken: token,
        }),
        notificationsApi<TelegramStatus>("/v1/me/telegram", {
          accessToken: token,
        }).catch(
          // Linking is optional: its outage must not hide the preferences.
          (): TelegramStatus => ({
            available: false,
            linked: false,
            linkedAt: null,
            botUsername: null,
          }),
        ),
      ]),
  );
  return (
    <>
      <PageHead title={t("title")} lead={t("lead")} />
      <Surface className="panel">
        <TelegramCard initial={telegram} />
      </Surface>
      <Surface className="panel">
        <PreferencesForm preferences={preferences} />
      </Surface>
    </>
  );
}
