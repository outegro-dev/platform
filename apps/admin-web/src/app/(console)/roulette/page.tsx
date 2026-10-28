import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LiveBoard } from "@/components/roulette/live-board";
import { Panel } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { load } from "@/lib/result";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roulette.live");
  return { title: t("title") };
}

async function Live() {
  const t = await getTranslations("roulette.live");
  const result = await load(() => services().roulette.live());
  if (!result.ok) {
    return (
      <Panel
        id="connection"
        title={t("connection")}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  return (
    <LiveBoard initial={result.data} serverTime={new Date().toISOString()} />
  );
}

/** The table right now, read again every few seconds. */
export default async function RouletteLivePage() {
  const access = await pageAccess("roulette.read");
  if (!access.ok) return access.element;
  const t = await getTranslations("roulette.live");
  return (
    <Suspense
      fallback={
        <>
          <PanelSkeleton label={t("title")} stats={5} rows={0} />
          <div className="grid-2">
            <PanelSkeleton label={t("exposure")} stats={0} rows={3} />
            <PanelSkeleton label={t("house")} stats={0} rows={5} />
          </div>
        </>
      }
    >
      <Live />
    </Suspense>
  );
}
