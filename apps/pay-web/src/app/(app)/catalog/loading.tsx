import { getTranslations } from "next-intl/server";
import { PageHead } from "@/components/page-head";
import { CatalogSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getTranslations("catalog");
  return (
    <>
      <PageHead
        index={t("index")}
        eyebrow={t("eyebrow")}
        title={t("title")}
        accent={t("titleAccent")}
        lead={t("lead")}
      />
      <CatalogSkeleton label={t("loading")} />
    </>
  );
}
