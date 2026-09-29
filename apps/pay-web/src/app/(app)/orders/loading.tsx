import { getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { OrderListSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getTranslations("orders");
  return (
    <>
      <PageHead
        index={t("index")}
        eyebrow={t("eyebrow")}
        title={t("title")}
        accent={t("titleAccent")}
        lead={t("lead")}
      />
      <div className="order-list">
        <div className="list-head og-eyebrow" aria-hidden="true">
          <span />
          <span>{t("listLabel")}</span>
          <span>{t("date")}</span>
          <span>{t("amount")}</span>
          <span>{t("status")}</span>
          <span />
        </div>
        <OrderListSkeleton label={t("loading")} />
      </div>
    </>
  );
}
