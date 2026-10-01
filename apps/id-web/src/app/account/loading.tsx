import { FormMessage } from "@outegro/ui/form-message";
import { Surface } from "@outegro/ui/surface";
import { useTranslations } from "next-intl";
import { PageHead } from "@/components/page-head";
import {
  LoadingNote,
  Skeleton,
  SkeletonLabel,
  SkeletonText,
} from "@/components/skeletons";
import { PlatformLinksSkeleton } from "./platform-links";

/** Profile while it loads: the same head and panels, values still pending. */
export default function ProfileLoading() {
  const t = useTranslations("profile");
  return (
    <>
      <PageHead title={t("title")} lead={t("lead")} />
      <Surface className="panel" aria-busy="true">
        <LoadingNote />
        <dl className="facts">
          <div>
            <dt>{t("email")}</dt>
            <dd>
              <Skeleton className="h-7 w-full max-w-72" />
            </dd>
          </div>
        </dl>
        <p className="muted small">
          <SkeletonText className="w-52" />
        </p>
      </Surface>
      <Surface className="panel" aria-busy="true">
        <div className="stack">
          <div className="field">
            <SkeletonLabel>{t("displayName")}</SkeletonLabel>
            <Skeleton className="h-12" />
          </div>
          <fieldset className="field">
            <legend className="field-legend">{t("language")}</legend>
            <div className="choices">
              <Skeleton className="h-11 w-27 rounded-full" />
              <Skeleton className="h-11 w-29 rounded-full" />
            </div>
          </fieldset>
          <div className="form-actions">
            <Skeleton className="h-12 w-35 rounded-full" />
            <FormMessage className="form-status items-center" lines={2} />
          </div>
        </div>
      </Surface>
      <PlatformLinksSkeleton />
    </>
  );
}
