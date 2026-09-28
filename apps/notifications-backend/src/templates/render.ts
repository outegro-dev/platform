import { render } from "@react-email/render";
import { type Locale, templateFor } from "./registry.js";

/** Renders a template to email parts (HTML and plain text). */
export async function renderEmail(
  key: string,
  locale: Locale,
  data: Record<string, string | number | boolean | null>,
  webUrl: string,
) {
  const template = templateFor(key);
  const element = template.email(locale, data, { webUrl });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject: template.subject(locale, data), html, text };
}
