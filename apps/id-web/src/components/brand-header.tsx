import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "./locale-switcher";

/** outegro wordmark with the product name, language switch and optional actions. */
export async function BrandHeader({ actions }: { actions?: ReactNode }) {
  const t = await getTranslations("brand");
  return (
    <header className="brand-header">
      <a href="/account" className="brand" aria-label={t("home")}>
        <span className="brand-word">outegro</span>
        <span className="brand-product og-eyebrow">{t("product")}</span>
      </a>
      <div className="brand-actions">
        <LocaleSwitcher />
        {actions}
      </div>
    </header>
  );
}
