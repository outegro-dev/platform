"use client";

import {
  type ApplicationStage,
  type ArchiveReason,
  applicationStages,
  archiveReasonSchema,
} from "@outegro/contracts/atelier";
import { Button } from "@outegro/ui/button";
import {
  ArrowsLeftRightIcon,
  CaretDownIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Dialog, DropdownMenu } from "radix-ui";

/**
 * "Move to…": the stages as a radio group in a menu (WAI-ARIA menu: arrows,
 * Enter, typing a letter, Escape back to the button). Archive asks why
 * first.
 */
export function MoveMenu({
  company,
  stage,
  onMove,
  onArchive,
  variant = "icon",
  label,
}: {
  company: string;
  stage: ApplicationStage;
  onMove: (stage: ApplicationStage) => void;
  onArchive: () => void;
  /** icon: the ⇄ button on a card; labelled: "Stage: Ready ▾" in the detail. */
  variant?: "icon" | "labelled";
  /** The labelled button's accessible name ("Stage: Ready"). */
  label?: string;
}) {
  const t = useTranslations("move");
  const stages = useTranslations("stages");
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        {variant === "icon" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="move-trigger"
            aria-label={t("button", { company })}
          >
            <ArrowsLeftRightIcon aria-hidden="true" weight="bold" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="stage-trigger"
            aria-label={label}
          >
            <span className="stage-trigger-label">{stages(stage)}</span>
            <CaretDownIcon aria-hidden="true" weight="bold" />
          </Button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu"
          align="end"
          sideOffset={6}
          collisionPadding={12}
        >
          <DropdownMenu.Label className="menu-label">
            {t("label")}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={stage}
            onValueChange={(next) => {
              const target = applicationStages.find((s) => s === next);
              if (!target || target === stage) return;
              if (target === "archived") onArchive();
              else onMove(target);
            }}
          >
            {applicationStages.map((option) => (
              <DropdownMenu.RadioItem
                key={option}
                value={option}
                className="menu-item"
                data-archive={option === "archived" || undefined}
              >
                <span className="menu-check">
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon aria-hidden="true" weight="bold" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {stages(option)}
                {option === stage ? (
                  <span className="menu-note">{t("current")}</span>
                ) : null}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Why a card goes to the archive: six answers and a way back. */
export function ArchiveDialog({
  company,
  open,
  onOpenChange,
  onPick,
}: {
  company: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (reason: ArchiveReason) => void;
}) {
  const t = useTranslations("move");
  const reasons = useTranslations("reasons");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="confirm-dialog">
          <Dialog.Title className="confirm-title">
            {t("reasonTitle")}
          </Dialog.Title>
          <Dialog.Description className="confirm-body">
            {t("reasonBody", { company })}
          </Dialog.Description>
          <div className="reason-grid">
            {archiveReasonSchema.options.map((reason) => (
              <Button
                key={reason}
                variant="outline"
                size="md"
                onClick={() => {
                  onOpenChange(false);
                  onPick(reason);
                }}
              >
                {reasons(reason)}
              </Button>
            ))}
          </div>
          <div className="confirm-actions">
            <Dialog.Close asChild>
              <Button variant="ghost" size="md">
                {t("cancel")}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
