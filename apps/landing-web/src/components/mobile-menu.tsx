"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@outegro/ui/dialog";
import type { ComponentProps } from "react";

/**
 * The menu below 1024px, as the Header unfolds it: the kit's dialog, which
 * brings Radix's focus trap, scroll lock and layers. Its own module, loaded
 * once the reader reaches for the menu's square rather than with every page
 * before its first paint; the square is the Header's own button, so focus
 * goes back to it by the Header's hand.
 */
export function MobileMenu({
  open,
  onOpenChange,
  title,
  description,
  children,
  ...content
}: Omit<ComponentProps<typeof DialogContent>, "title"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's name and description, for assistive technology. */
  title: string;
  description: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} {...content}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
