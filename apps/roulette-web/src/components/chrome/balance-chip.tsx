"use client";

import { observer } from "mobx-react-lite";
import { useLocale, useTranslations } from "next-intl";
import { formatAmount } from "@/lib/format";
import { GrumbleIcon } from "../grumble-icon";
import { useStore } from "../providers";

/** The player's grumbles: live while the game socket is open, a dash while nobody knows. */
export const BalanceChip = observer(function BalanceChip() {
  const store = useStore();
  const t = useTranslations("account");
  const locale = useLocale();
  if (!store.player) return null;
  const balance = store.balance;
  const label =
    balance === null
      ? t("unknown")
      : t("balance", { amount: formatAmount(balance, locale) });
  return (
    <span className="balance-chip" title={label} data-testid="balance">
      <GrumbleIcon className="size-5" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        {balance === null ? "—" : formatAmount(balance, locale)}
      </span>
    </span>
  );
});
