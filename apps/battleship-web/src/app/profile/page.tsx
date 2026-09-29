import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProfileView } from "@/components/stats/profile-view";
import { loadMatches, loadProfile, loadStats } from "@/lib/api";
import { signInHref } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage() {
  const [profile, stats, history] = await Promise.all([
    loadProfile(),
    loadStats(),
    loadMatches(null),
  ]);
  if (profile.status === "signed-out") redirect(signInHref("/profile"));
  return (
    <main id="main" className="app-main og-container">
      <ProfileView
        stats={stats.status === "ok" ? stats.data : null}
        history={history.status === "ok" ? history.data : null}
      />
    </main>
  );
}
