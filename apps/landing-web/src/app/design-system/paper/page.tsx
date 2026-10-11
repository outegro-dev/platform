import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PaperJourney } from "@/components/paper/paper-journey";

export const metadata: Metadata = {
  title: "Paper journey — Nick Lukashik",
  robots: { index: false, follow: false },
};

type Step = { title: string; body: string; see: string };

// Lab for the scroll-driven paper cartoon of the process steps: scroll
// through the pinned stage; reduced motion shows the sticker layout.
export default async function PaperLab() {
  const t = await getTranslations("process");
  const steps = t.raw("steps") as Step[];
  return (
    <main className="pj-lab">
      <header className="pj-lab-intro">
        <h1>
          {t("title")} {t("titleAccent")}
        </h1>
        <p>{t("intro")}</p>
      </header>
      <PaperJourney steps={steps} labels={{ youSee: t("youSee") }} />
      <footer className="pj-lab-outro">
        <p>{t("ai")}</p>
      </footer>
    </main>
  );
}
