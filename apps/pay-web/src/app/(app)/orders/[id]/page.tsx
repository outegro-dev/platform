import { ArrowLeftIcon, CloudSlashIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OrderView } from "@/components/order/order-view";
import { RetryButton } from "@/components/retry-button";
import { StatePanel } from "@/components/state-panel";
import { forBrowser, payments, requireToken } from "@/lib/api";
import { serviceLink } from "@/lib/services";
import { signInPath } from "@/lib/sso";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("order");
  return { title: t("metaTitle") };
}

/**
 * One order: its status (watched live while pending, which makes this the
 * return page after Lava), progress, what it gives and a summary.
 */
export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const from = `/orders/${id}`;
  const token = await requireToken(from);
  const [order, catalog] = await Promise.all([
    payments.order(token, id),
    payments.catalog(),
  ]);

  if (!order.ok) {
    if (order.error === "unauthorized") redirect(signInPath(from));
    if (order.error === "not-found" || order.error === "invalid") notFound();
    const t = await getTranslations("order");
    const states = await getTranslations("states");
    return (
      <>
        <Link className="back-link" href="/orders">
          <ArrowLeftIcon aria-hidden="true" />
          {t("back")}
        </Link>
        <StatePanel
          tone="danger"
          role="alert"
          icon={<CloudSlashIcon />}
          title={states("unavailableTitle")}
          body={t("unavailableBody")}
          actions={<RetryButton />}
        />
      </>
    );
  }

  // What the purchase gives comes from the catalog; the grant is the fallback.
  const product = catalog.ok
    ? catalog.data.products.find((p) => p.key === order.data.productKey)
    : undefined;
  const service = product?.service ?? order.data.access?.service ?? null;
  return (
    <OrderView
      initial={forBrowser(order.data)}
      context={{
        service,
        serviceUrl: serviceLink(service)?.shop ?? null,
        description: product?.description ?? null,
        periodicity: product?.periodicity ?? null,
      }}
    />
  );
}
