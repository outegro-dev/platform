"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@outegro/ui/dialog";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function ContactDialog({
  variant = "outline",
  compact = false,
  label,
  children,
}: {
  variant?: "primary" | "outline" | "glass";
  compact?: boolean;
  label?: string;
  /** Contact list, rendered on the server and passed through. */
  children: ReactNode;
}) {
  const t = useTranslations("contact");
  const name = label ?? t("button");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={compact ? "icon" : "lg"}
          aria-label={compact ? name : undefined}
          className={compact ? "contact-compact" : undefined}
        >
          {!compact && name}
          <ArrowUpRightIcon />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")} className="contact-dialog">
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <DialogDescription>{t("dialogDescription")}</DialogDescription>
        {children}
        <p className="contact-location">{t("location")}</p>
      </DialogContent>
    </Dialog>
  );
}
