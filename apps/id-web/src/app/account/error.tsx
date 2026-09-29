"use client";

import { ErrorNotice } from "@/components/error-notice";

/** Outages show a retry, never an empty list pretending there is no data (TC-ID-09-03). */
export default function AccountError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return <ErrorNotice retry={retry} />;
}
