"use client";

import { Button } from "@outegro/ui/button";
import { PrinterIcon } from "@phosphor-icons/react";

/** Opens the browser's print dialog: a printer, or "Save as PDF". */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="cv-print"
      onClick={() => window.print()}
    >
      <PrinterIcon aria-hidden="true" />
      {label}
    </Button>
  );
}
