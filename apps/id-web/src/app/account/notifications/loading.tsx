import { FormMessage } from "@outegro/ui/form-message";
import { Surface } from "@outegro/ui/surface";
import { useTranslations } from "next-intl";
import { PageHead } from "@/components/page-head";
import { LoadingNote, Skeleton } from "@/components/skeletons";

const categories = ["security", "billing", "service"] as const;
const channels = ["inbox", "email", "telegram"] as const;

/** Preferences while they load: the real matrix with its switches pending. */
export default function NotificationsLoading() {
  const t = useTranslations("preferences");
  return (
    <>
      <PageHead title={t("title")} lead={t("lead")} />
      <Surface className="panel" aria-busy="true">
        <LoadingNote />
        <div className="stack">
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <td />
                  {channels.map((channel) => (
                    <th key={channel} scope="col">
                      {t(`channels.${channel}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category}>
                    <th scope="row">{t(`categories.${category}`)}</th>
                    {channels.map((channel) => (
                      <td key={channel} data-label={t(`channels.${channel}`)}>
                        <span className="check">
                          <Skeleton className="size-4.5 rounded-[4px]" />
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t("telegramHint")}</p>
          <div className="form-actions">
            <Skeleton className="h-12 w-22 rounded-full" />
            <FormMessage className="form-status items-center" lines={2} />
          </div>
        </div>
      </Surface>
    </>
  );
}
