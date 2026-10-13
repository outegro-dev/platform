import { Button } from "@outegro/ui/button";
import type { Metadata, Viewport } from "next";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import { SiteFooter } from "@/components/site-footer";
import { Ransom } from "@/components/zine/ransom";
import { unlisted } from "@/lib/metadata";
import { sso } from "@/lib/sso";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound.meta");
  // Next.js marks every 404 noindex itself; a robots tag of ours would be a
  // second one
  return { ...unlisted({ title: t("title") }), robots: null };
}

// the main page's cream paper, which this page is printed on too
export const viewport: Viewport = { themeColor: "#f6eede" };

/**
 * Any address the site does not have: an erratum slip pasted into the
 * issue, in the reader's language, with the way back to the main page.
 */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <>
      <Header accounts={sso !== null} />
      <main id="main" className="erratum og-container">
        <div className="erratum-card" id="top">
          <span aria-hidden="true" className="tape erratum-tape" />
          <p className="erratum-kicker">{t("kicker")}</p>
          <h1 className="erratum-h1">
            <span className="erratum-code">
              <Ransom text="404" />
            </span>
            <span className="sr-only"> — </span>
            <span className="erratum-title">{t("title")}</span>
          </h1>
          <p className="erratum-body">{t("body")}</p>
          <div className="erratum-actions">
            <Button asChild size="lg">
              <a href="/">{t("home")}</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="/stack">{t("stack")}</a>
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
