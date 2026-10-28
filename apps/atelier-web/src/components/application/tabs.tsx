"use client";

import type {
  ApplicationDetail,
  AtelierTaskType,
} from "@outegro/contracts/atelier";
import { Button } from "@outegro/ui/button";
import { CopyButton } from "@outegro/ui/copy-button";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  CircleIcon,
  FilePdfIcon,
  HandIcon,
  MinusCircleIcon,
  SparkleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { channelIcons } from "@/components/board/parts";
import { useFormat } from "@/components/ui/format";

/* ---------- Shared ---------- */

/** A tab with nothing to show yet: what will appear, and when. */
function EmptyTab({ title, body }: { title: string; body?: string }) {
  return (
    <div className="tab-empty">
      <p className="tab-empty-title">{title}</p>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

/* ---------- Resume ---------- */

/**
 * The PDF inside the page where the browser has a viewer; elsewhere (most
 * phones, headless browsers) a sheet of paper with a link to open it.
 */
function PdfPreview({ url, title }: { url: string; title: string }) {
  const t = useTranslations("resume");
  const [viewer, setViewer] = useState(false);
  useEffect(() => {
    setViewer(
      (navigator as Navigator & { pdfViewerEnabled?: boolean })
        .pdfViewerEnabled === true,
    );
  }, []);
  return (
    <div className="cv-sheet">
      {viewer ? (
        <iframe className="cv-frame" src={url} title={title} />
      ) : (
        <div className="cv-fallback">
          <FilePdfIcon aria-hidden="true" className="cv-fallback-icon" />
          <p>{t("previewFallback")}</p>
          <Button asChild variant="outline" size="sm">
            <a href={url} target="_blank" rel="noopener">
              <ArrowSquareOutIcon aria-hidden="true" />
              {t("openPdf")}
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

export function ResumeTab({ cv }: { cv: ApplicationDetail["cv"] }) {
  const t = useTranslations("resume");
  const format = useFormat();
  if (!cv) return <EmptyTab title={t("none")} body={t("noneBody")} />;
  return (
    <div className="resume">
      <PdfPreview url={cv.pdfUrl} title={t("preview", { file: cv.fileName })} />
      <div className="resume-side">
        <dl className="facts">
          <div className="fact fact-wide">
            <dt>{t("file")}</dt>
            <dd>
              <a
                className="file-link"
                href={cv.pdfUrl}
                target="_blank"
                rel="noopener"
              >
                <FilePdfIcon aria-hidden="true" />
                <span className="mono break">{cv.fileName}</span>
              </a>
            </dd>
          </div>
          <div className="fact fact-wide">
            <dt>{t("share")}</dt>
            <dd>
              {cv.shareUrl ? (
                <span className="share">
                  <span className="mono share-url">{cv.shareUrl}</span>
                  <CopyButton
                    value={cv.shareUrl}
                    label={t("copy")}
                    aria-label={t("copyLink")}
                    copiedLabel={t("copied")}
                    failedLabel={t("copyFailed")}
                    variant="outline"
                    size="sm"
                  />
                </span>
              ) : (
                <span className="muted">{t("noShare")}</span>
              )}
            </dd>
          </div>
          <div className="fact">
            <dt>{t("opens")}</dt>
            <dd>{t("opensValue", { count: cv.opens })}</dd>
          </div>
          <div className="fact">
            <dt>{t("pages")}</dt>
            <dd>{t("pagesValue", { count: cv.pages })}</dd>
          </div>
          <div className="fact fact-wide">
            <dt>{t("ats")}</dt>
            <dd>
              {cv.atsCoverage === null ? (
                <span className="muted">{t("atsNone")}</span>
              ) : (
                <span className="meter-line">
                  <span
                    className="meter"
                    aria-hidden="true"
                    style={{ ["--fill" as string]: `${cv.atsCoverage * 100}%` }}
                  />
                  {t("atsValue", { value: format.percent(cv.atsCoverage) })}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <section className="changes" aria-labelledby="cv-changes">
          <h3 id="cv-changes" className="sub-title">
            {t("changes")}
          </h3>
          {cv.changes.length ? (
            <ul className="changes-list">
              {cv.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("noChanges")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- Fit ---------- */

const coverageIcons = {
  direct: CheckCircleIcon,
  related: CircleHalfIcon,
  weak: CircleDashedIcon,
  missing: XCircleIcon,
} as const;

const coverageTones = {
  direct: "ok",
  related: "info",
  weak: "warn",
  missing: "danger",
} as const;

export function FitTab({ fit }: { fit: ApplicationDetail["fit"] }) {
  const t = useTranslations("fit");
  if (!fit) return <EmptyTab title={t("none")} body={t("noneBody")} />;
  const counts = { direct: 0, related: 0, weak: 0, missing: 0 };
  for (const r of fit.requirements) counts[r.label]++;
  const total = fit.requirements.length || 1;
  const groups = (["must", "responsibility", "preferred"] as const)
    .map((importance) => ({
      importance,
      items: fit.requirements.filter((r) => r.importance === importance),
    }))
    .filter((group) => group.items.length);
  return (
    <div className="fit">
      <div className="fit-summary">
        <p className="fit-score">
          <span className="fit-score-n">{Math.round(fit.score)}</span>
          <span className="fit-score-label">{t("score")}</span>
        </p>
        <div className="fit-bars">
          <div className="coverage-bar" aria-hidden="true">
            {(["direct", "related", "weak", "missing"] as const).map((label) =>
              counts[label] ? (
                <span
                  key={label}
                  data-tone={coverageTones[label]}
                  style={{ flexGrow: counts[label] / total }}
                />
              ) : null,
            )}
          </div>
          <p className="fit-counts">{t("summary", counts)}</p>
        </div>
      </div>
      {groups.map((group) => (
        <section
          key={group.importance}
          className="req-group"
          aria-labelledby={`req-${group.importance}`}
        >
          <h3 id={`req-${group.importance}`} className="sub-title">
            {t(`importance.${group.importance}`)}
          </h3>
          <ul className="req-list">
            {group.items.map((requirement) => {
              const Icon = coverageIcons[requirement.label];
              return (
                <li key={requirement.id} className="req">
                  <span
                    className="coverage-chip"
                    data-tone={coverageTones[requirement.label]}
                  >
                    <Icon aria-hidden="true" weight="bold" />
                    {t(`labels.${requirement.label}`)}
                  </span>
                  <p className="req-text">{requirement.text}</p>
                  <p className="req-cases">
                    {requirement.caseIds.length ? (
                      <>
                        <span className="sr-only">{t("cases")}: </span>
                        {requirement.caseIds.map((id) => (
                          <span key={id} className="case-tag">
                            {id}
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="muted">{t("noCase")}</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ---------- Texts ---------- */

export function TextsTab({
  materials,
  answers,
}: {
  materials: ApplicationDetail["materials"];
  answers: ApplicationDetail["answers"];
}) {
  const t = useTranslations("texts");
  if (!materials.length && !answers.length)
    return <EmptyTab title={t("none")} body={t("noneBody")} />;
  const kindName = (kind: string) =>
    t.has(`kinds.${kind}`) ? t(`kinds.${kind}`) : kind.replace(/_/g, " ");
  return (
    <div className="texts">
      {materials.length ? (
        <section aria-labelledby="texts-materials" className="texts-group">
          <h3 id="texts-materials" className="sub-title">
            {t("materials")}
          </h3>
          <ul className="text-blocks">
            {materials.map((material) => {
              const name = kindName(material.kind);
              const full = material.subject
                ? `${material.subject}\n\n${material.body}`
                : material.body;
              return (
                <li key={`${material.kind}-${material.locale}`}>
                  <article className="text-block" lang={material.locale}>
                    <header className="text-block-head">
                      <h4 className="text-block-title">
                        {name}
                        <span className="locale-tag">
                          <span aria-hidden="true">
                            {t(`locales.${material.locale}`)}
                          </span>
                          <span className="sr-only">
                            {t(`localeNames.${material.locale}`)}
                          </span>
                        </span>
                      </h4>
                      <CopyButton
                        value={full}
                        label={t("copy")}
                        aria-label={t("copyNamed", { what: name })}
                        copiedLabel={t("copied")}
                        failedLabel={t("copyFailed")}
                        variant="outline"
                        size="sm"
                      />
                    </header>
                    {material.subject ? (
                      <p className="text-subject">
                        <span className="muted">{t("subject")}: </span>
                        {material.subject}
                      </p>
                    ) : null}
                    <p className="text-body">{material.body}</p>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {answers.length ? (
        <section aria-labelledby="texts-answers" className="texts-group">
          <h3 id="texts-answers" className="sub-title">
            {t("answers")}
          </h3>
          <dl className="answers">
            {answers.map((answer) => (
              <div key={answer.question} className="answer">
                <dt className="answer-q">{answer.question}</dt>
                <dd className="answer-a">
                  <p>{answer.answer}</p>
                  <CopyButton
                    value={answer.answer}
                    label={t("copy")}
                    aria-label={t("copyNamed", { what: answer.question })}
                    copiedLabel={t("copied")}
                    failedLabel={t("copyFailed")}
                    variant="ghost"
                    size="sm"
                  />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/* ---------- Contacts ---------- */

export function ContactsTab({
  contacts,
}: {
  contacts: ApplicationDetail["contacts"];
}) {
  const t = useTranslations("contacts");
  const channels = useTranslations("channels");
  const format = useFormat();
  if (!contacts.length)
    return <EmptyTab title={t("none")} body={t("noneBody")} />;
  return (
    <div>
      <p className="tab-lead">{t("count", { count: contacts.length })}</p>
      <ol className="touches">
        {contacts.map((contact) => {
          const Icon = channelIcons[contact.kind];
          return (
            <li
              key={`${contact.kind}-${contact.target}-${contact.sentAt ?? "draft"}`}
              className="touch"
            >
              <span className="touch-icon" aria-hidden="true">
                <Icon weight="bold" />
              </span>
              <div className="touch-body">
                <p className="touch-head">
                  <span className="touch-kind">{channels(contact.kind)}</span>
                  <span className="status-chip" data-status={contact.status}>
                    {t(`statuses.${contact.status}`)}
                  </span>
                </p>
                <p className="mono break touch-target">{contact.target}</p>
                {contact.note ? (
                  <p className="touch-note">{contact.note}</p>
                ) : null}
              </div>
              <p className="touch-when">
                {contact.sentAt ? (
                  <time dateTime={contact.sentAt}>
                    {format.dateTime(contact.sentAt)}
                  </time>
                ) : (
                  <span className="muted">{t("notSent")}</span>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------- History ---------- */

export function HistoryTab({
  history,
}: {
  history: ApplicationDetail["history"];
}) {
  const t = useTranslations("history");
  const format = useFormat();
  if (!history.length) return <EmptyTab title={t("none")} />;
  return (
    <ol className="timeline">
      {history.map((event) => (
        <li
          key={`${event.at}-${event.action}-${event.details ?? ""}`}
          className="event"
          data-source={event.source}
        >
          <time className="event-time" dateTime={event.at}>
            {format.dateTime(event.at)}
          </time>
          <div className="event-body">
            <p className="event-action">
              {t.has(`actions.${event.action}`)
                ? t(`actions.${event.action}`)
                : event.action}
              <span className="source-chip" data-source={event.source}>
                {t(`sources.${event.source}`)}
              </span>
            </p>
            {event.details ? (
              <p className="event-details">{event.details}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Pipeline ---------- */

const stepIcons = {
  waiting: CircleIcon,
  running: SpinnerGapIcon,
  ok: CheckCircleIcon,
  failed: WarningCircleIcon,
  skipped: MinusCircleIcon,
  needs_human: HandIcon,
} as const;

export function PipelineTab({
  pipeline,
  onRetry,
  busy,
}: {
  pipeline: ApplicationDetail["pipeline"];
  onRetry: (step: AtelierTaskType) => void;
  busy: boolean;
}) {
  const t = useTranslations("pipelineTab");
  const steps = useTranslations("steps");
  const format = useFormat();
  if (!pipeline.length) return <EmptyTab title={t("none")} />;
  const done = pipeline.filter((s) => s.status === "ok").length;
  const calls = pipeline.reduce((sum, s) => sum + s.llmCalls, 0);
  const ms = pipeline.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  return (
    <div>
      <p className="tab-lead">
        {t("total", {
          steps: `${done}/${pipeline.length}`,
          calls,
          time: format.duration(ms),
        })}
      </p>
      <ol className="steps">
        {pipeline.map((step) => {
          const Icon = stepIcons[step.status];
          const retryable =
            step.status === "ok" ||
            step.status === "failed" ||
            step.status === "needs_human";
          return (
            <li key={step.step} className="step" data-status={step.status}>
              <span className="step-icon" aria-hidden="true">
                <Icon weight={step.status === "ok" ? "fill" : "bold"} />
              </span>
              <div className="step-body">
                <p className="step-head">
                  <span className="step-name">{steps(step.step)}</span>
                  <span className="step-status">
                    {t(`statuses.${step.status}`)}
                  </span>
                </p>
                <p className="step-meta">
                  {step.ms !== null ? (
                    <span>{format.duration(step.ms)}</span>
                  ) : null}
                  {step.llmCalls > 0 ? (
                    <span className="llm-chip">
                      <SparkleIcon aria-hidden="true" weight="fill" />
                      {t("calls", { count: step.llmCalls })}
                    </span>
                  ) : null}
                </p>
                {step.note ? <p className="step-note">{step.note}</p> : null}
              </div>
              {retryable ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="step-retry"
                  aria-label={t("retryHere", { step: steps(step.step) })}
                  title={t("retryHere", { step: steps(step.step) })}
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (!busy) onRetry(step.step);
                  }}
                >
                  <ArrowClockwiseIcon aria-hidden="true" weight="bold" />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export type TabRender = { value: string; label: string; content: ReactNode };
