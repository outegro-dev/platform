import { randomUUID } from "node:crypto";
import { HandCoinsIcon, MinusCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";
import { grantGrumbles, takeGrumbles } from "@/app/(console)/wallet/actions";
import { ActionDialog } from "@/components/ui/action-dialog";
import { ADMIN_MAX_AMOUNT, type WalletView } from "@/lib/adapters/wallet";
import { AmountField } from "./amount-field";
import { formatGrumbles } from "./grumbles";

/**
 * Grant and take, each a preview → confirm dialog with a reason. The
 * commandId is new on every render, so a form sent twice (a lost answer,
 * a double click) applies once, and the next command after the page
 * refreshes is a new one.
 */
export async function WalletCommands({ wallet }: { wallet: WalletView }) {
  const t = await getTranslations("wallet.command");
  const amount = await getTranslations("actions.grumbles");
  const locale = await getLocale();
  const balance = formatGrumbles(wallet.balance, locale);
  const restricted =
    wallet.state === "restricted" ? [t("restricted")] : ([] as string[]);
  const hidden = { userId: wallet.userId, commandId: randomUUID() };
  return (
    <div className="row-gap">
      <ActionDialog
        action={grantGrumbles}
        triggerLabel={t("grant")}
        triggerVariant="primary"
        triggerIcon={<HandCoinsIcon aria-hidden="true" />}
        title={t("grantTitle")}
        description={t("grantDescription")}
        consequences={[
          amount("now", { balance }),
          t("grantEffect"),
          ...restricted,
          t("once"),
          t("audited"),
        ]}
        confirmLabel={t("grantConfirm")}
        hidden={hidden}
      >
        <AmountField
          balance={wallet.balance}
          direction={1}
          max={ADMIN_MAX_AMOUNT}
        />
      </ActionDialog>
      <ActionDialog
        action={takeGrumbles}
        triggerLabel={t("adjust")}
        triggerIcon={<MinusCircleIcon aria-hidden="true" />}
        title={t("adjustTitle")}
        description={t("adjustDescription")}
        consequences={[
          amount("now", { balance }),
          t("adjustEffect"),
          t("once"),
          t("audited"),
        ]}
        confirmLabel={t("adjustConfirm")}
        destructive
        hidden={{ ...hidden, commandId: randomUUID() }}
      >
        <AmountField
          balance={wallet.balance}
          direction={-1}
          max={ADMIN_MAX_AMOUNT}
        />
      </ActionDialog>
    </div>
  );
}
