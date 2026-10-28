import type { PipelineOverview } from "@outegro/contracts/atelier";
import {
  CheckCircleIcon,
  CircleIcon,
  HandIcon,
  PauseCircleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LiftPause } from "@/components/pipeline/lift-pause";
import { Unavailable } from "@/components/ui/states";
import { loadPipeline } from "@/lib/api";
import { getFormatter } from "@/lib/request";
import { applicationHref } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pipeline");
  return { title: t("title") };
}

const jobIcons = {
  queued: CircleIcon,
  running: SpinnerGapIcon,
  waiting_human: HandIcon,
  done: CheckCircleIcon,
  failed: WarningCircleIcon,
} as const;

/** What runs, what waits and which model accounts can take work. */
export default async function PipelinePage() {
  const t = await getTranslations("pipeline");
  const loaded = await loadPipeline();
  return (
    <main id="main" className="page">
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p className="page-lead">{t("lead")}</p>
      </header>
      {loaded.status === "ok" ? (
        <div className="pipeline">
          <Providers providers={loaded.data.providers} />
          <Queues queues={loaded.data.queues} />
          <Jobs jobs={loaded.data.jobs} />
        </div>
      ) : (
        <Unavailable retryHref="/pipeline" />
      )}
    </main>
  );
}

async function Providers({
  providers,
}: {
  providers: PipelineOverview["providers"];
}) {
  const t = await getTranslations("pipeline");
  const format = await getFormatter();
  return (
    <section className="pipeline-providers" aria-labelledby="providers">
      <h2 id="providers" className="section-title">
        {t("providers")}
      </h2>
      <ul className="provider-list">
        {providers.map((provider) => {
          const paused =
            provider.pausedUntil !== null &&
            Date.parse(provider.pausedUntil) > format.now;
          const state = paused
            ? "paused"
            : provider.available
              ? "available"
              : "unavailable";
          return (
            <li key={provider.id} className="provider" data-state={state}>
              <div className="provider-head">
                <h3 className="provider-name mono">{provider.id}</h3>
                <span className="state-chip" data-state={state}>
                  {state === "paused" ? (
                    <PauseCircleIcon aria-hidden="true" weight="bold" />
                  ) : state === "available" ? (
                    <CheckCircleIcon aria-hidden="true" weight="bold" />
                  ) : (
                    <WarningCircleIcon aria-hidden="true" weight="bold" />
                  )}
                  {t(state)}
                </span>
              </div>
              <p className="provider-load">
                <span
                  className="slots"
                  aria-hidden="true"
                  style={{
                    ["--slots" as string]: provider.concurrency,
                  }}
                >
                  {Array.from({ length: provider.concurrency }, (_, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: slots are positions, not items.
                      key={i}
                      data-busy={i < provider.inFlight || undefined}
                    />
                  ))}
                </span>
                {t("load", {
                  inFlight: provider.inFlight,
                  concurrency: provider.concurrency,
                })}
              </p>
              {provider.reason ? (
                <p className="provider-reason">{provider.reason}</p>
              ) : null}
              {paused && provider.pausedUntil ? (
                <div className="provider-pause">
                  <p>
                    <strong>
                      {t("pausedFor", {
                        when: format.relative(provider.pausedUntil),
                      })}
                    </strong>
                    <time className="muted" dateTime={provider.pausedUntil}>
                      {t("pausedUntil", {
                        time: format.dateTime(provider.pausedUntil),
                      })}
                    </time>
                  </p>
                  <LiftPause provider={provider.id} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function Queues({ queues }: { queues: PipelineOverview["queues"] }) {
  const t = await getTranslations("pipeline");
  const steps = await getTranslations("steps");
  const busy = queues.filter((q) => q.waiting + q.running > 0);
  const idle = queues.length - busy.length;
  const max = Math.max(1, ...busy.map((q) => q.waiting + q.running));
  return (
    <section className="pipeline-queues" aria-labelledby="queues">
      <h2 id="queues" className="section-title">
        {t("queues")}
      </h2>
      <table className="queue-table">
        <thead>
          <tr>
            <th scope="col">{t("columns.step")}</th>
            <th scope="col" className="num">
              {t("waiting")}
            </th>
            <th scope="col" className="num">
              {t("running")}
            </th>
          </tr>
        </thead>
        <tbody>
          {busy.map((queue) => (
            <tr key={queue.type}>
              <th scope="row">
                <span className="queue-name">{steps(queue.type)}</span>
                <span
                  className="queue-bar"
                  aria-hidden="true"
                  style={{
                    ["--waiting" as string]: queue.waiting / max,
                    ["--running" as string]: queue.running / max,
                  }}
                >
                  <span data-part="running" />
                  <span data-part="waiting" />
                </span>
              </th>
              <td className="num">{queue.waiting}</td>
              <td className="num">{queue.running}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {idle ? (
        <p className="queue-idle muted">{t("queuesIdle", { count: idle })}</p>
      ) : null}
    </section>
  );
}

async function Jobs({ jobs }: { jobs: PipelineOverview["jobs"] }) {
  const t = await getTranslations("pipeline");
  const steps = await getTranslations("steps");
  const format = await getFormatter();
  const kindName = (kind: string) => {
    const key = `kinds.${kind.replace(/\./g, "_")}`;
    return t.has(key) ? t(key) : kind;
  };
  return (
    <section className="pipeline-jobs" aria-labelledby="jobs">
      <h2 id="jobs" className="section-title">
        {t("jobs")}
      </h2>
      {jobs.length ? (
        <ul className="job-list">
          {jobs.map((job) => {
            const Icon = jobIcons[job.status];
            return (
              <li key={job.id} className="job" data-status={job.status}>
                <span className="job-icon" aria-hidden="true">
                  <Icon weight="bold" />
                </span>
                <div className="job-main">
                  <p className="job-title">
                    {job.applicationId ? (
                      <Link
                        href={applicationHref(job.applicationId)}
                        scroll={false}
                        prefetch={false}
                        className="link"
                      >
                        {job.title}
                      </Link>
                    ) : (
                      job.title
                    )}
                  </p>
                  <p className="job-meta">
                    <span className="kind-tag">{kindName(job.kind)}</span>
                    <span>{job.step ? steps(job.step) : t("noStep")}</span>
                  </p>
                </div>
                <p className="job-status">
                  <span className="job-status-chip" data-status={job.status}>
                    {t(`jobStatuses.${job.status}`)}
                  </span>
                </p>
                <dl className="job-times">
                  <div>
                    <dt>{t("columns.started")}</dt>
                    <dd>
                      <time dateTime={job.startedAt}>
                        {format.dateTime(job.startedAt)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("columns.updated")}</dt>
                    <dd>
                      <time dateTime={job.updatedAt}>
                        {format.relative(job.updatedAt)}
                      </time>
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{t("noJobs")}</p>
      )}
    </section>
  );
}
