import { createRequestConfig } from "@outegro/i18n/server";

export default createRequestConfig(
  (locale) => import(`../messages/${locale}.json`),
);
