import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ApplicationDrawer } from "@/components/application/drawer";
import { Unavailable } from "@/components/ui/states";
import { isApplicationId, loadApplication } from "@/lib/api";
import { applicationHref } from "@/lib/routes";

/** An application opened from the board: the side panel over it. */
export default async function ApplicationPanel({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isApplicationId(id)) notFound();
  const loaded = await loadApplication(id);
  if (loaded.status === "ok")
    return <ApplicationDrawer detail={loaded.data} now={Date.now()} />;
  const t = await getTranslations(
    loaded.status === "not-found" ? "notFound" : "unavailable",
  );
  return (
    <ApplicationDrawer
      now={Date.now()}
      problem={{
        title: t("title"),
        body:
          loaded.status === "not-found" ? (
            <p className="muted">{t("body")}</p>
          ) : (
            <Unavailable
              retryHref={applicationHref(id)}
              size="sm"
              headingLevel={3}
            />
          ),
      }}
    />
  );
}
