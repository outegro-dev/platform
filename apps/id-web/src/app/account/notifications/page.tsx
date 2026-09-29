import { Surface } from "@outegro/ui/surface";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { notificationsApi, type Preferences, withSession } from "@/lib/api";
import { PreferencesForm } from "./preferences-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("preferences");
  return { title: t("title") };
}

export default async function NotificationsPage() {
  const t = await getTranslations("preferences");
  const preferences = await withSession("/account/notifications", (token) =>
    notificationsApi<Preferences>("/v1/me/notification-preferences", {
      accessToken: token,
    }),
  );
  return (
    <>
      <PageHead title={t("title")} lead={t("lead")} />
      <Surface className="panel">
        <PreferencesForm preferences={preferences} />
      </Surface>
    </>
  );
}
