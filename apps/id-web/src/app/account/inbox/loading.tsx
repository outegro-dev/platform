import { useTranslations } from "next-intl";
import { PageHead } from "@/components/page-head";
import { LoadingNote, Skeleton, SkeletonText } from "@/components/skeletons";

/** Inbox while it loads: the head with its counter line, then one message. */
export default function InboxLoading() {
  const t = useTranslations("inbox");
  return (
    <>
      <PageHead title={t("title")} lead={t("lead")}>
        <p className="og-eyebrow">
          <SkeletonText className="w-24" />
        </p>
      </PageHead>
      <div className="list" aria-busy="true">
        <LoadingNote />
        <Skeleton className="h-28 rounded-(--radius-lg)" />
      </div>
    </>
  );
}
