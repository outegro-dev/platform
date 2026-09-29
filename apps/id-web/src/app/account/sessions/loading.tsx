import { Surface } from "@outegro/ui/surface";
import { useTranslations } from "next-intl";
import { PageHead } from "@/components/page-head";
import { LoadingNote, Skeleton, SkeletonText } from "@/components/skeletons";

/** Sessions while they load: this device's row and the footer line. */
export default function SessionsLoading() {
  const t = useTranslations("sessions");
  return (
    <>
      <PageHead title={t("title")} lead={t("lead")} />
      <ul className="list" aria-busy="true">
        <li>
          <Surface className="row">
            <LoadingNote />
            <div className="row-main">
              <p className="row-title">
                <Skeleton className="h-7 w-full max-w-60" />
              </p>
              <p className="muted small">
                <SkeletonText className="w-40" />
              </p>
              <p className="muted small">
                <SkeletonText className="w-full max-w-80" />
              </p>
            </div>
          </Surface>
        </li>
      </ul>
      <div className="list-footer">
        <SkeletonText className="w-36" />
      </div>
    </>
  );
}
