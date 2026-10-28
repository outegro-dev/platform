import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddVacancyForm } from "@/components/add/add-vacancy-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("add");
  return { title: t("title") };
}

/** Add a vacancy by hand: one field for a link or the text. */
export default async function AddVacancyPage() {
  const t = await getTranslations("add");
  return (
    <main id="main" className="page page-narrow">
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p className="page-lead">{t("lead")}</p>
      </header>
      <AddVacancyForm />
    </main>
  );
}
