"use client";

import { ProhibitIcon } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { voidRound } from "@/app/(console)/roulette/actions";
import { CommandDialog } from "@/components/ui/command-dialog";
import type { VoidPreview } from "@/lib/adapters/roulette";
import { formatNumber } from "@/lib/format";
import { Grm } from "./bits";

/**
 * Cancel a round that is not paid out yet (owners only, `roulette.void`):
 * the preview counts the bets and grumbles that go back, then the round is
 * voided with the reason.
 */
export function VoidCommand({ round }: { round: number }) {
  const t = useTranslations("roulette.void");
  const locale = useLocale();
  return (
    <CommandDialog<VoidPreview>
      action={voidRound}
      triggerLabel={t("trigger")}
      triggerIcon={<ProhibitIcon aria-hidden="true" />}
      triggerVariant="destructive"
      title={t("title", { round })}
      description={t("description")}
      consequences={[t("effectBets"), t("effectWallet"), t("audited")]}
      confirmLabel={t("confirm")}
      destructive
      hidden={{ round: String(round) }}
      renderPreview={(preview) => (
        <dl className="facts">
          <div className="fact">
            <dt>{t("previewBets")}</dt>
            <dd className="num">{formatNumber(preview.bets, locale)}</dd>
          </div>
          <div className="fact">
            <dt>{t("previewRefunded")}</dt>
            <dd>
              <Grm amount={preview.refunded} locale={locale} />
            </dd>
          </div>
        </dl>
      )}
    />
  );
}
