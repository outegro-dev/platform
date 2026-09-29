import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { RETURN_COOKIE, returnTarget } from "@/lib/return-to";

/**
 * "Back to Battleship": shown on every page while the buyer came here from
 * a platform app. The remembered target is checked against the list again.
 */
export async function ReturnBar() {
  const back = returnTarget((await cookies()).get(RETURN_COOKIE)?.value);
  if (!back) return null;
  const t = await getTranslations("return");
  return (
    <nav className="return-bar og-container" aria-label={t("label")}>
      <a
        className="return-link og-glass"
        href={back.href}
        data-testid="return-link"
      >
        <ArrowLeftIcon aria-hidden="true" />
        {t(`to.${back.app}`)}
      </a>
    </nav>
  );
}
