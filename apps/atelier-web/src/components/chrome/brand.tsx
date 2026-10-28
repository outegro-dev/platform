import { NeedleIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** The platform wordmark with Atelier's needle, home to the board. */
export async function Brand() {
  const t = await getTranslations("brand");
  return (
    <Link href="/" className="brand" aria-label={t("home")}>
      <span className="brand-mark" aria-hidden="true">
        <NeedleIcon weight="bold" />
      </span>
      <span className="brand-text">
        <span className="brand-word">outegro</span>
        <span className="brand-product">{t("product")}</span>
      </span>
    </Link>
  );
}
