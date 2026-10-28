import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink, Panel, PanelLink } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { WalletCard } from "@/components/wallet/wallet-card";
import { pageAccess } from "@/lib/access";
import { walletSources } from "@/lib/adapters/wallet";
import { one, oneOf, type Params, type SearchParams } from "@/lib/params";
import { can } from "@/lib/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wallet.card");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Params<"userId">;
  searchParams: SearchParams;
}) {
  const access = await pageAccess("wallet.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("wallet.card");
  const { userId } = await params;
  const query = await searchParams;
  const cursor = one(query, "cursor");
  const source = oneOf(query, "source", walletSources);
  if (!UUID.test(userId))
    return (
      <Panel title={t("title")}>
        <FailureState failure={{ kind: "not-found" }} what={t("what")} />
      </Panel>
    );
  const links = (
    <>
      <BackLink href="/wallet/wallets">{t("back")}</BackLink>
      {can(access.granted, "users.read") && (
        <PanelLink href={`/users/${userId}?tab=wallet`}>{t("user")}</PanelLink>
      )}
    </>
  );
  return (
    <Suspense
      key={`${source ?? ""}|${cursor ?? ""}`}
      fallback={<PanelSkeleton label={t("title")} stats={4} rows={6} />}
    >
      <WalletCard
        userId={userId}
        cursor={cursor}
        source={source}
        canAdjust={can(access.granted, "wallet.adjust")}
        path={`/wallet/wallets/${userId}`}
        title={userId}
        action={links}
      />
    </Suspense>
  );
}
