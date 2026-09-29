"use client";

import { Button } from "@outegro/ui/button";
import { ListIcon, XIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Dialog as Sheet } from "radix-ui";
import { type ReactNode, useState } from "react";
import { NavigateContext } from "./nav-links";

/** Phones and tablets: a sticky bar with the wordmark and a navigation sheet. */
export function MobileBar({
  brand,
  children,
}: {
  brand: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);
  return (
    <div className="mobile-bar">
      <Sheet.Root open={open} onOpenChange={setOpen}>
        <Sheet.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("openMenu")}>
            <ListIcon />
          </Button>
        </Sheet.Trigger>
        <Sheet.Portal>
          <Sheet.Overlay className="nav-sheet-overlay" />
          <Sheet.Content className="nav-sheet" aria-describedby={undefined}>
            <div className="brand">
              <Sheet.Title className="sr-only">{t("menu")}</Sheet.Title>
              {brand}
              <Sheet.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t("closeMenu")}>
                  <XIcon />
                </Button>
              </Sheet.Close>
            </div>
            <NavigateContext value={() => setOpen(false)}>
              {children}
            </NavigateContext>
          </Sheet.Content>
        </Sheet.Portal>
      </Sheet.Root>
      {brand}
      <span aria-hidden="true" style={{ width: 44 }} />
    </div>
  );
}
