"use client";

import { Input } from "@outegro/ui/input";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

/**
 * The balance to set, with before → after: the preview the operator
 * confirms. The wallet works out the difference under its lock, so a
 * stake landing meanwhile still ends at this balance.
 */
export function BalanceField({ balance }: { balance: string }) {
  const t = useTranslations("actions.grumbles");
  const locale = useLocale();
  const id = useId();
  const [value, setValue] = useState("");
  const format = (n: bigint) => new Intl.NumberFormat(locale).format(n);
  const target = /^(0|[1-9]\d{0,14})$/.test(value) ? BigInt(value) : null;
  const before = BigInt(balance);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t("target")}
      </label>
      <Input
        id={id}
        name="balance"
        required
        inputMode="numeric"
        pattern="0|[1-9][0-9]{0,14}"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value.trim())}
      />
      <span className="field-hint">{t("targetHint")}</span>
      <output htmlFor={id} className="field-hint num" aria-live="polite">
        {target === null
          ? t("now", { balance: format(before) })
          : target === before
            ? t("unchanged")
            : t("previewSet", {
                before: format(before),
                after: format(target),
              })}
      </output>
    </div>
  );
}
