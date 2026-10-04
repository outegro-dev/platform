import { getTranslations } from "next-intl/server";
import type { AccessRule } from "@/lib/adapters/edu";
import { presetOf } from "@/lib/education";

export type RuleWords = {
  /** "Free", "Signed-in readers", "Paid". */
  title: string;
  /** One line for tables: who opens it and the free chapters. */
  summary: string;
  /** Full sentences for the book page. */
  detail: string;
  /** Features a grant must carry (paid books only), as Payments names them. */
  features: string[];
};

/** A book's access rule in the operator's words. */
export async function getRuleWords(): Promise<
  (rule: AccessRule, slug: string) => RuleWords
> {
  const t = await getTranslations("education.rule");
  return (rule, slug) => {
    switch (rule.mode) {
      case "free":
        return {
          title: t("free"),
          summary: t("freeSummary"),
          detail: t("freeDetail"),
          features: [],
        };
      case "signed_in":
        return {
          title: t("signedIn"),
          summary: t("signedInSummary"),
          detail: t("signedInDetail"),
          features: [],
        };
      case "grant": {
        const preset = presetOf(rule.features, slug);
        const listed = rule.features.join(", ");
        const count = rule.previewChapters;
        return {
          title: t("grant"),
          summary: `${preset ? t(`presets.${preset}`) : listed} · ${t("freeChapters", { count })}`,
          detail: `${t("grantDetail", { who: preset ? t(`who.${preset}`) : listed })} ${t("previewDetail", { count })}`,
          features: rule.features,
        };
      }
    }
  };
}
