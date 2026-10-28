"use client";

import type {
  ApplicationDetail,
  ApplicationStage,
  ArchiveReason,
  AtelierTaskType,
} from "@outegro/contracts/atelier";
import { Button } from "@outegro/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@outegro/ui/tabs";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { type ElementType, type ReactNode, useId, useState } from "react";
import { ArchiveDialog, MoveMenu } from "@/components/board/move-menu";
import {
  ChannelLabel,
  FlagList,
  ScoreChip,
  useSourceLabel,
} from "@/components/board/parts";
import { useWrite } from "@/components/chrome/action-status";
import { useFormat } from "@/components/ui/format";
import { writeApi } from "@/lib/client-api";
import {
  ContactsTab,
  FitTab,
  HistoryTab,
  PipelineTab,
  ResumeTab,
  TextsTab,
} from "./tabs";

const tabKeys = [
  "resume",
  "fit",
  "texts",
  "contacts",
  "history",
  "pipeline",
] as const;
type TabKey = (typeof tabKeys)[number];

/** The stage a fresh application opens on: what is most useful there. */
function firstTab(detail: ApplicationDetail): TabKey {
  if (detail.cv) return "resume";
  if (detail.fit) return "fit";
  return "pipeline";
}

/**
 * One application: who and what, the stage, the actions (send, retry from
 * a step, move, open the vacancy) and six tabs. The same view fills the
 * side panel over the board and the application's own page.
 */
export function DetailView({
  detail,
  now,
  Heading = "h1",
  headerAside,
  inDialog = false,
}: {
  detail: ApplicationDetail;
  now: number;
  /** The company heading: h1 on the page, the dialog's title in the panel. */
  Heading?: ElementType;
  /** Open-as-page and close, in the panel. */
  headerAside?: ReactNode;
  /** In the panel the dialog is named by the heading (Radix gives it its id). */
  inDialog?: boolean;
}) {
  const t = useTranslations("detail");
  const stageName = useTranslations("stages");
  const reasonName = useTranslations("reasons");
  const stepName = useTranslations("steps");
  const boardT = useTranslations("board");
  const format = useFormat();
  const sourceLabel = useSourceLabel();
  const { run, pending } = useWrite();
  const [tab, setTab] = useState<TabKey>(() => firstTab(detail));
  const [asking, setAsking] = useState(false);
  const ids = useId();
  const { card, vacancy } = detail;

  const move = (stage: ApplicationStage, archiveReason?: ArchiveReason) =>
    run(
      () =>
        writeApi("POST", `/applications/${card.id}/stage`, {
          stage,
          ...(archiveReason ? { archiveReason } : {}),
        }),
      {
        success: () =>
          stage === "archived" && archiveReason
            ? boardT("archived", {
                company: card.company,
                reason: reasonName(archiveReason),
              })
            : boardT("moved", {
                company: card.company,
                stage: stageName(stage),
              }),
        failure: boardT("moveFailed", {
          company: card.company,
          stage: stageName(card.stage),
        }),
      },
    );

  const retry = (fromStep?: AtelierTaskType) => {
    const failed = detail.pipeline.find(
      (s) => s.status === "failed" || s.status === "needs_human",
    );
    const from = fromStep ?? failed?.step;
    return run(
      () =>
        writeApi(
          "POST",
          `/applications/${card.id}/retry`,
          from ? { fromStep: from } : {},
        ),
      {
        success: () =>
          t("retried", { step: from ? stepName(from) : stepName("fetch") }),
      },
    );
  };

  const send = () =>
    run(() => writeApi("POST", `/applications/${card.id}/send`, {}), {
      success: () => t("sent"),
    });

  const canSend = card.stage === "ready" && detail.cv !== null;
  const beforeSend = ["found", "fit", "building", "ready"].includes(card.stage);
  const failedStep = detail.pipeline.find(
    (s) => s.status === "failed" || s.status === "needs_human",
  );
  const retrySteps = detail.pipeline.filter((s) => s.status !== "waiting");
  const salary = vacancy.salary;

  const content: Record<TabKey, ReactNode> = {
    resume: <ResumeTab cv={detail.cv} />,
    fit: <FitTab fit={detail.fit} />,
    texts: <TextsTab materials={detail.materials} answers={detail.answers} />,
    contacts: <ContactsTab contacts={detail.contacts} />,
    history: <HistoryTab history={detail.history} />,
    pipeline: (
      <PipelineTab
        pipeline={detail.pipeline}
        onRetry={(step) => retry(step)}
        busy={pending}
      />
    ),
  };

  return (
    <article
      className="detail"
      aria-labelledby={inDialog ? undefined : `${ids}-title`}
    >
      <header className="detail-head">
        <div className="detail-top">
          <p className="detail-kicker">
            <span>{t("source", { source: sourceLabel(card.source) })}</span>
            {card.channel ? (
              <ChannelLabel channel={card.channel} />
            ) : (
              <span className="muted">{t("noChannel")}</span>
            )}
          </p>
          {headerAside ? (
            <div className="detail-aside">{headerAside}</div>
          ) : null}
        </div>
        <div className="detail-title-row">
          <div className="detail-titles">
            <Heading
              className="detail-company"
              id={inDialog ? undefined : `${ids}-title`}
            >
              {card.company}
            </Heading>
            <p className="detail-role">{card.role}</p>
          </div>
          <ScoreChip score={card.score} size="lg" />
        </div>
        <p className="detail-meta">
          {vacancy.location ? <span>{vacancy.location}</span> : null}
          {salary && salary.min !== null && salary.max !== null ? (
            <span>
              {t("salary", {
                min: format.money(salary.min, salary.currency),
                max: format.money(salary.max, salary.currency),
                period: t(`periods.${salary.period}`),
              })}
            </span>
          ) : null}
          <span>
            {card.sentAt
              ? t("sentAt", { when: format.dateTime(card.sentAt) })
              : t("updated", { when: format.relative(card.updatedAt, now) })}
          </span>
        </p>
        {card.stage === "archived" && card.archiveReason ? (
          <p className="archived-note">
            {t("archivedAs", { reason: reasonName(card.archiveReason) })}
          </p>
        ) : null}
        <FlagList flags={card.flags} label={boardT("flags")} />

        <div className="detail-actions">
          <div className="stage-control">
            <span className="stage-control-label" aria-hidden="true">
              {t("stage")}
            </span>
            <MoveMenu
              company={card.company}
              stage={card.stage}
              variant="labelled"
              label={t("stageButton", { stage: stageName(card.stage) })}
              onMove={(stage) => move(stage)}
              onArchive={() => window.setTimeout(() => setAsking(true), 0)}
            />
          </div>
          {beforeSend ? (
            <Button
              size="sm"
              onClick={() => {
                if (canSend && !pending) send();
              }}
              aria-disabled={!canSend || pending || undefined}
              aria-describedby={canSend ? undefined : `${ids}-send-hint`}
              data-unavailable={!canSend || undefined}
            >
              <PaperPlaneTiltIcon aria-hidden="true" weight="bold" />
              {t("send")}
            </Button>
          ) : null}
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <Button variant="outline" size="sm">
                <ArrowClockwiseIcon aria-hidden="true" weight="bold" />
                {t("retryShort")}
                <CaretDownIcon aria-hidden="true" weight="bold" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="menu"
                align="start"
                sideOffset={6}
                collisionPadding={12}
              >
                {failedStep ? (
                  <>
                    <DropdownMenu.Item
                      className="menu-item"
                      onSelect={() => retry(failedStep.step)}
                    >
                      {t("retryFailed")}
                      <span className="menu-note">
                        {stepName(failedStep.step)}
                      </span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="menu-separator" />
                  </>
                ) : null}
                <DropdownMenu.Label className="menu-label">
                  {t("retry")}
                </DropdownMenu.Label>
                {(retrySteps.length ? retrySteps : detail.pipeline).map(
                  (step) => (
                    <DropdownMenu.Item
                      key={step.step}
                      className="menu-item"
                      onSelect={() => retry(step.step)}
                    >
                      {stepName(step.step)}
                    </DropdownMenu.Item>
                  ),
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Button asChild variant="outline" size="sm">
            <a href={vacancy.url} target="_blank" rel="noopener noreferrer">
              <ArrowSquareOutIcon aria-hidden="true" weight="bold" />
              {t("openVacancy")}
              <span className="sr-only">{t("opensInNewTab")}</span>
            </a>
          </Button>
        </div>
        {beforeSend && !canSend ? (
          <p className="send-hint" id={`${ids}-send-hint`}>
            {t("sendHint")}
          </p>
        ) : null}
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const key = tabKeys.find((k) => k === value);
          if (key) setTab(key);
        }}
        className="detail-tabs"
      >
        <TabsList aria-label={t("tabs.label")}>
          {tabKeys.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabKeys.map((key) => (
          <TabsContent key={key} value={key} className="tab-panel">
            {content[key]}
          </TabsContent>
        ))}
      </Tabs>

      <ArchiveDialog
        company={card.company}
        open={asking}
        onOpenChange={setAsking}
        onPick={(reason) => move("archived", reason)}
      />
    </article>
  );
}
