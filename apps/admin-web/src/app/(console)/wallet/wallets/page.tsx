import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FilterBar, SelectField, TextField } from "@/components/ui/data";
import { TableSkeleton } from "@/components/ui/skeleton";
import { WalletsTable } from "@/components/wallet/wallets-table";
import { pageAccess } from "@/lib/access";
import { type WalletFilter, walletStates } from "@/lib/adapters/wallet";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams, uuidParam } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wallet.wallets");
  return { title: t("title") };
}

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("wallet.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("wallet.wallets");
  const label = await getLabels();
  const query = await searchParams;
  const filter: WalletFilter = {
    state: oneOf(query, "state", walletStates),
    userId: uuidParam(query, "userId"),
    cursor: one(query, "cursor"),
  };
  return (
    <Suspense
      key={JSON.stringify(filter)}
      fallback={<TableSkeleton label={t("title")} />}
    >
      <WalletsTable filter={filter} title={t("title")}>
        <FilterBar
          action="/wallet/wallets"
          label={t("filters")}
          active={Boolean(filter.state || filter.userId)}
        >
          <TextField
            name="userId"
            label={t("user")}
            value={filter.userId}
            placeholder={t("userPlaceholder")}
            type="text"
          />
          <SelectField
            name="state"
            label={t("state")}
            value={filter.state}
            allLabel={t("anyState")}
            options={walletStates.map((state) => ({
              value: state,
              label: label("walletState", state),
            }))}
          />
        </FilterBar>
      </WalletsTable>
    </Suspense>
  );
}
