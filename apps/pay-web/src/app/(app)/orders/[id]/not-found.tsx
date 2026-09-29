import { Button } from "@outegro/ui/button";
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { StatePanel } from "@/components/state-panel";

/** Missing and someone else's orders look the same (no data is disclosed). */
export default async function OrderNotFound() {
  const t = await getTranslations("order");
  return (
    <>
      <Link className="back-link" href="/orders">
        <ArrowLeftIcon aria-hidden="true" />
        {t("back")}
      </Link>
      <StatePanel
        icon={<MagnifyingGlassIcon />}
        title={t("notFoundTitle")}
        body={t("notFoundBody")}
        actions={
          <Button asChild size="lg" variant="outline">
            <Link href="/orders">{t("notFoundAction")}</Link>
          </Button>
        }
      />
    </>
  );
}
