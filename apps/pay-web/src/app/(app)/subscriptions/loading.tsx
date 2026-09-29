import { getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { SubscriptionsSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getTranslations("subscriptions");
  return (
    <>
      <PageHead
        index={t("index")}
        eyebrow={t("eyebrow")}
        title={t("title")}
        accent={t("titleAccent")}
        lead={t("lead")}
      />
      <section className="sub-section">
        <h2 className="section-title">{t("current")}</h2>
        <SubscriptionsSkeleton label={t("loading")} />
      </section>
    </>
  );
}
