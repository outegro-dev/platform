import { getTranslations } from "next-intl/server";
import { withEducationTargets } from "./education";
import { educationBooks } from "./queries";

/**
 * What "Give access" offers: the catalog's products, plus the Education
 * library and each book while Education answers (nothing sells them yet).
 * The book list needs edu.read; without it only the catalog is offered.
 */
export async function grantTargets(
  granted: ReadonlySet<string>,
  catalog: readonly (readonly [string, string])[],
): Promise<[string, string][]> {
  const t = await getTranslations("education.targets");
  const books = granted.has("edu.read") ? await educationBooks() : null;
  return withEducationTargets(catalog, books?.ok ? books.data : null, {
    library: t("library"),
    book: (title) => t("book", { title }),
  });
}
