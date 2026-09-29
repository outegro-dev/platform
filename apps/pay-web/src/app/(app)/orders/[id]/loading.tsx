import { Skeleton } from "@outegro/ui/skeleton";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { OrderDetailSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getTranslations("order");
  return (
    <>
      <div className="order-head">
        <Link className="back-link" href="/orders">
          <ArrowLeftIcon aria-hidden="true" />
          {t("back")}
        </Link>
        <div className="order-head-meta">
          <Skeleton style={{ width: 180, height: 12 }} />
        </div>
        <Skeleton className="order-head-skeleton" />
      </div>
      <OrderDetailSkeleton label={t("loading")} />
    </>
  );
}
