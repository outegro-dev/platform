import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlayScreen } from "@/components/play/play-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("play") };
}

/** The match: placement, battle and result, driven by the match store. */
export default function PlayPage() {
  return (
    <main id="main" className="app-main og-container play-main">
      <PlayScreen />
    </main>
  );
}
