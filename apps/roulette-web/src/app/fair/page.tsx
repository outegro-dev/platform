import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { FairChecker } from "@/components/fair/fair-checker";
import { loadFair } from "@/lib/api";
import { formatAmount } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("fair");
  return { title: t("title") };
}

/**
 * Provably fair (ADR-012): the published chain, how a number comes from a
 * seed, and a check of any round that runs in the browser.
 */
export default async function FairPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("fair");
  const locale = await getLocale();
  const raw = (await searchParams).round;
  const requested = typeof raw === "string" ? Number(raw) : Number.NaN;
  const initialRound =
    Number.isSafeInteger(requested) && requested >= 1 ? requested : null;
  const chain = await loadFair();
  return (
    <main id="main" className="app-main og-container fair-page">
      <header className="fair-head">
        <h1>{t("title")}</h1>
        <p>{t("lead")}</p>
      </header>
      <section className="fair-card" aria-labelledby="fair-chain">
        <h2 id="fair-chain" className="sr-only">
          {t("commit")}
        </h2>
        {chain.status === "ok" ? (
          <dl className="fair-chain" data-testid="fair-chain">
            <div>
              <dt>{t("commit")}</dt>
              <dd className="fair-hash">{chain.data.commit}</dd>
            </div>
            <div>
              <dt>{t("publicSeed")}</dt>
              <dd className="fair-hash">{chain.data.publicSeed}</dd>
            </div>
            <div>
              <dt>{t("chainLength")}</dt>
              <dd>{formatAmount(chain.data.chainLength, locale)}</dd>
            </div>
            <div>
              <dt>{t("lastRevealed")}</dt>
              <dd>{formatAmount(chain.data.lastRevealed, locale)}</dd>
            </div>
          </dl>
        ) : (
          <p className="fair-muted" role="status">
            {t("unavailable")}
          </p>
        )}
      </section>
      <section className="fair-card" aria-labelledby="fair-how">
        <h2 id="fair-how">{t("howTitle")}</h2>
        <ol className="fair-how">
          <li>{t("how1")}</li>
          <li>{t("how2")}</li>
          <li>{t("how3")}</li>
          <li>{t("how4")}</li>
        </ol>
      </section>
      <FairChecker
        initialRound={initialRound}
        publicSeed={chain.status === "ok" ? chain.data.publicSeed : null}
      />
    </main>
  );
}
