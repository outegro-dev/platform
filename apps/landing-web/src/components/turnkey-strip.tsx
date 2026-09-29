import { useTranslations } from "next-intl";

/**
 * Right under the hero: every stage of a turnkey product, in order, so the
 * "end to end" promise is a concrete list rather than a slogan.
 */
export function TurnkeyStrip() {
  const t = useTranslations("turnkey");
  const steps = t.raw("steps") as string[];
  return (
    <section id="turnkey" className="turnkey" aria-labelledby="turnkey-title">
      <div className="og-container turnkey-inner">
        <h2 id="turnkey-title" className="og-eyebrow turnkey-label">
          {t("label")}
        </h2>
        <ol className="turnkey-steps">
          {steps.map((step, i) => (
            <li
              key={step}
              data-reveal
              style={{ "--reveal-delay": `${i * 55}ms` } as React.CSSProperties}
            >
              {step}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
