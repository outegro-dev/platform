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
  children,
}: {
  variant?: "primary" | "outline" | "glass";
  /** Contact list, rendered on the server and passed through. */
  children: ReactNode;
}) {
  const t = useTranslations("contact");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant} size="lg">
          {t("button")}
          <ArrowUpRightIcon />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")} className="contact-dialog">
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <DialogDescription>{t("dialogDescription")}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
