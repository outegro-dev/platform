"use client";

import { Button } from "@outegro/ui/button";
import { ListIcon, XIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Dialog as Sheet } from "radix-ui";
import { type ReactNode, useState } from "react";
import { NavigateContext } from "./nav-links";

/** Phones and tablets: the account, language and theme in a sheet. */
export function MenuSheet({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  return (
    <Sheet.Root open={open} onOpenChange={setOpen}>
      <Sheet.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("openMenu")}>
          <ListIcon aria-hidden="true" weight="bold" />
        </Button>
      </Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Overlay className="sheet-overlay" />
        <Sheet.Content className="menu-sheet" aria-describedby={undefined}>
          <div className="menu-sheet-head">
            <Sheet.Title className="menu-sheet-title">{t("menu")}</Sheet.Title>
            <Sheet.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("closeMenu")}>
                <XIcon aria-hidden="true" weight="bold" />
              </Button>
            </Sheet.Close>
          </div>
          <NavigateContext value={() => setOpen(false)}>
            {children}
          </NavigateContext>
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
