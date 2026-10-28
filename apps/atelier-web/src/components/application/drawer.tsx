"use client";

import type { ApplicationDetail } from "@outegro/contracts/atelier";
import { Button } from "@outegro/ui/button";
import { ArrowsOutSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { type ReactNode, useState } from "react";
import { applicationHref } from "@/lib/routes";
import { DetailView } from "./detail-view";

/** The company heading as the panel's dialog title. */
function DrawerTitle({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog.Title asChild>
      <h2 className={className}>{children}</h2>
    </Dialog.Title>
  );
}

/**
 * An application opened from the board: a panel from the right on a
 * desktop or tablet, a full-screen sheet on a phone. The board stays where
 * it was underneath; closing goes back in history (Escape, the button, a
 * click on the board), so Back and Forward open and close it too.
 */
export function ApplicationDrawer({
  detail,
  now,
  problem,
}: {
  detail?: ApplicationDetail;
  now: number;
  /** Why the application cannot be shown (missing, backend down). */
  problem?: { title: string; body: ReactNode };
}) {
  const t = useTranslations("detail");
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setOpen(false);
        router.back();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className="drawer"
          tabIndex={-1}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Focus the panel itself, not the first control in it.
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          {detail ? (
            <DetailView
              detail={detail}
              now={now}
              Heading={DrawerTitle}
              inDialog
              headerAside={
                <>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    aria-label={t("openPage")}
                    title={t("openPage")}
                  >
                    {/* A full load: the page, not the panel again. */}
                    <a href={applicationHref(detail.card.id)}>
                      <ArrowsOutSimpleIcon aria-hidden="true" weight="bold" />
                    </a>
                  </Button>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label={t("close")}>
                      <XIcon aria-hidden="true" weight="bold" />
                    </Button>
                  </Dialog.Close>
                </>
              }
            />
          ) : problem ? (
            <div className="detail drawer-problem">
              <div className="detail-top">
                <Dialog.Title className="detail-company">
                  {problem.title}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label={t("close")}>
                    <XIcon aria-hidden="true" weight="bold" />
                  </Button>
                </Dialog.Close>
              </div>
              {problem.body}
            </div>
          ) : (
            <DrawerLoading />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** While the application loads: its shape, so nothing jumps when it arrives. */
function DrawerLoading() {
  const t = useTranslations("detail");
  return (
    <div className="detail detail-loading" aria-busy="true">
      <Dialog.Title className="sr-only">{t("loading")}</Dialog.Title>
      <p className="loading-note" role="status">
        {t("loading")}
      </p>
      <div className="skeleton-line" style={{ width: "40%" }} />
      <div className="skeleton-line skeleton-lg" style={{ width: "70%" }} />
      <div className="skeleton-line" style={{ width: "55%" }} />
      <div className="skeleton-block" />
    </div>
  );
}
