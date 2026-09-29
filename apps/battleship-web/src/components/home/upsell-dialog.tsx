"use client";

import { Button } from "@outegro/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@outegro/ui/dialog";
import { CrownSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** Why Hard/Expert are locked and where Premium is; also explains a server refusal. */
export function UpsellDialog({
  open,
  onOpenChange,
  fromServer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromServer: boolean;
}) {
  const t = useTranslations("upsell");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <span className="lock-badge" aria-hidden="true">
            <CrownSimpleIcon weight="fill" />
          </span>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("body")}</DialogDescription>
          {fromServer ? (
            <p className="small muted" data-testid="premium-required-note">
              {t("serverSaid")}
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("later")}
          </Button>
          <Button asChild>
            <Link href="/shop">{t("cta")}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
