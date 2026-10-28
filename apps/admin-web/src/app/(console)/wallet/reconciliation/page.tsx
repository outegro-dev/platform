import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DataTable, Time } from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pairs } from "@/components/wallet/pairs";
import { pageAccess } from "@/lib/access";
import { shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { load } from "@/lib/result";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wallet.reconciliation");
  return { title: t("issues") };
}

/** wallet:<userId>:<unit> opens that wallet; system and unit subjects read as they are. */
function Subject({ subject }: { subject: string }) {
  const [kind, id] = subject.split(":");
  if (kind === "wallet" && id)
    return (
      <Link href={`/wallet/wallets/${id}`} className="link mono">
        {shortId(id)}
      </Link>
    );
  return <span className="mono max-[719px]:break-all">{subject}</span>;
}

async function Reconciliation() {
  const t = await getTranslations("wallet.reconciliation");
  const label = await getLabels();
  const result = await load(() => services().wallet.reconciliation());
  if (!result.ok)
    return (
      <Panel
        title={t("issues")}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  const { issues, runs } = result.data;
  return (
    <>
      <Panel flush id="issues" title={t("issues")} note={t("issuesNote")}>
        {issues.length === 0 ? (
          <EmptyState size="sm" title={t("none")} body={t("noneBody")} />
        ) : (
          <DataTable label={t("issues")}>
            <thead>
              <tr>
                <th scope="col">{t("colKind")}</th>
                <th scope="col">{t("colSubject")}</th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colSeen")}</th>
                <th scope="col">{t("colDetails")}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <td data-primary="">
                    <span className="cell-main">
                      {label("walletIssue", issue.kind)}
                    </span>
                  </td>
                  <td data-label={t("colSubject")}>
                    <Subject subject={issue.subject} />
                  </td>
                  <td data-label={t("colState")}>
                    <Status tone={issue.state === "open" ? "bad" : "ok"}>
                      {label("walletIssueState", issue.state)}
                    </Status>
                  </td>
                  <td data-label={t("colSeen")}>
                    {/* One block, so on a phone the two times stay under
                        each other instead of side by side. */}
                    <span>
                      <Time iso={issue.firstSeenAt} />
                      <span className="cell-sub">
                        <Time iso={issue.resolvedAt ?? issue.lastSeenAt} />
                      </span>
                    </span>
                  </td>
                  <td data-label={t("colDetails")}>
                    <span className="small max-[719px]:break-all">
                      {pairs(issue.details)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
      <Panel flush id="runs" title={t("runs")}>
        {runs.length === 0 ? (
          <EmptyState size="sm" title={t("noRuns")} />
        ) : (
          <DataTable label={t("runs")}>
            <thead>
              <tr>
                <th scope="col">{t("colStarted")}</th>
                <th scope="col">{t("colMode")}</th>
                <th scope="col" className="num">
                  {t("colChecked")}
                </th>
                <th scope="col" className="num">
                  {t("colFound")}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td data-primary="">
                    <Time iso={run.startedAt} />
                  </td>
                  <td data-label={t("colMode")}>
                    {label("runMode", run.mode)}
                    {run.failed ? (
                      <>
                        {" "}
                        <Status tone="bad">{t("failed")}</Status>
                      </>
                    ) : (
                      !run.finishedAt && ` · ${t("running")}`
                    )}
                  </td>
                  <td data-label={t("colChecked")} className="num">
                    {run.checkedWallets}
                  </td>
                  <td data-label={t("colFound")} className="num">
                    {run.issuesFound > 0 ? (
                      <Status tone="bad">{run.issuesFound}</Status>
                    ) : (
                      run.issuesFound
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </>
  );
}

export default async function WalletReconciliationPage() {
  const access = await pageAccess("wallet.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("wallet.reconciliation");
  return (
    <Suspense fallback={<TableSkeleton label={t("issues")} rows={4} />}>
      <Reconciliation />
    </Suspense>
  );
}
