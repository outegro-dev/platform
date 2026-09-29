import { getTranslations } from "next-intl/server";
import { cache } from "react";

export type Label = (kind: string, value: string) => string;

/** Message keys cannot contain dots ("role.granted" → "role_granted"). */
export const labelKey = (value: string) => value.replace(/[.\s]/g, "_");

/**
 * Translated names of domain states and enums (`labels.<kind>.<value>`);
 * a value the console does not know yet shows as readable text.
 */
export const getLabels = cache(async (): Promise<Label> => {
  const t = await getTranslations("labels");
  return (kind, value) => {
    const key = `${kind}.${labelKey(value)}`;
    return t.has(key) ? t(key) : value.replace(/[._]/g, " ");
  };
});
