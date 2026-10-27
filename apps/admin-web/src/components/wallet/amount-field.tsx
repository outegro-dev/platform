"use client";

import { Input } from "@outegro/ui/input";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

/**
 * The amount of a grant or a take, with the balance it would leave: the
 * preview the operator confirms. The service checks again on its side.
 */
export function AmountField({
  balance,
  direction,
  max,
}: {
  balance: string;
  direction: 1 | -1;
  max: string;
}) {
  const t = useTranslations("actions.grumbles");
  const locale = useLocale();
  const id = useId();
  const [value, setValue] = useState("");
  const format = (n: bigint) => new Intl.NumberFormat(locale).format(n);
  const amount = /^[1-9]\d{0,14}$/.test(value) ? BigInt(value) : null;
  const after =
    amount === null ? null : BigInt(balance) + BigInt(direction) * amount;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t("amount")}
      </label>
      <Input
        id={id}
        name="amount"
        required
        inputMode="numeric"
        pattern="[1-9][0-9]{0,14}"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value.trim())}
      />
      <span className="field-hint">
        {t("amountHint", { max: format(BigInt(max)) })}
      </span>
      <output htmlFor={id} className="field-hint num" aria-live="polite">
        {after === null
          ? t("now", { balance: format(BigInt(balance)) })
          : after < 0n
            ? t("previewShort")
            : t("preview", { after: format(after) })}
      </output>
    </div>
  );
}
