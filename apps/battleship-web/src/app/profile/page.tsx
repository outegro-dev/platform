import { pageHref } from "@outegro/ui/lib/platform";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ProfileView } from "@/components/stats/profile-view";
import {
  loadMatches,
  loadProfile,
  loadStats,
  loadSubscriptions,
  payments,
} from "@/lib/api";
import { platformUrls } from "@/lib/env";
import { currentPremium, premiumProductKey } from "@/lib/ownership";
import { payLinks } from "@/lib/pay-links";
import { signInHref } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage() {
  const locale = (await getLocale()) === "ru" ? "ru" : "en";
  // Payments tells which subscription stands behind Premium (renewal, cancel).
  const [profile, stats, history, subscriptions, catalog] = await Promise.all([
    loadProfile(),
    loadStats(),
    loadMatches(null),
    loadSubscriptions(),
    payments.catalog(locale),
  ]);
  if (profile.status === "signed-out") redirect(signInHref("/profile"));
  return (
    <main id="main" className="app-main og-container">
      <ProfileView
        stats={stats.status === "ok" ? stats.data : null}
        history={history.status === "ok" ? history.data : null}
        purchases={{
          premiumPlan: currentPremium(
            subscriptions,
            premiumProductKey(catalog),
          ),
          links: payLinks("/profile"),
          accountUrl: pageHref(platformUrls, "account"),
        }}
      />
    </main>
  );
}
