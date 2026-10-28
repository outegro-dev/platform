import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DetailView } from "@/components/application/detail-view";
import { Unavailable } from "@/components/ui/states";
import { isApplicationId, loadApplication } from "@/lib/api";
import { applicationHref } from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/applications/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!isApplicationId(id)) return {};
  const loaded = await loadApplication(id);
  return loaded.status === "ok"
    ? { title: `${loaded.data.card.company}, ${loaded.data.card.role}` }
    : {};
}

/** An application's own page: the deep link, a reload, a shared tab. */
export default async function ApplicationPage({
  params,
}: PageProps<"/applications/[id]">) {
  const { id } = await params;
  if (!isApplicationId(id)) notFound();
  const t = await getTranslations("detail");
  const loaded = await loadApplication(id);
  if (loaded.status === "not-found") notFound();
  return (
    <main id="main" className="page page-detail">
      <Link href="/" className="back-link">
        <ArrowLeftIcon aria-hidden="true" weight="bold" />
        {t("back")}
      </Link>
      {loaded.status === "ok" ? (
        <div className="detail-sheet">
          <DetailView detail={loaded.data} now={Date.now()} />
        </div>
      ) : (
        <Unavailable retryHref={applicationHref(id)} headingLevel={1} />
      )}
    </main>
  );
}
