import { Button } from "@outegro/ui/button";
import {
  LockSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ReplayViewer } from "@/components/stats/replay-viewer";
import { loadReplay } from "@/lib/api";
import { signInHref } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("replay");
  return { title: t("title") };
}

/** A finished match, move by move (Premium; the server answers 403 otherwise). */
export default async function ReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("replay");
  const upsell = await getTranslations("upsell");
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const replay = valid
    ? await loadReplay(id)
    : { status: "not-found" as const };
  if (replay.status === "signed-out") redirect(signInHref(`/replay/${id}`));
  if (replay.status === "ok") {
    return (
      <main id="main" className="app-main og-container">
        <ReplayViewer replay={replay.data} />
      </main>
    );
  }
  const locked = replay.status === "forbidden";
  return (
    <main id="main" className="app-main og-container">
      <section
        className="notice"
        data-testid={locked ? "replay-locked" : "replay-missing"}
      >
        <span className="notice-icon" aria-hidden="true">
          {locked ? <LockSimpleIcon /> : <WarningCircleIcon />}
        </span>
        <h1>
          {locked
            ? t("lockedTitle")
            : replay.status === "not-found"
              ? t("notFound")
              : t("unavailable")}
        </h1>
        {locked ? <p>{t("lockedBody")}</p> : null}
        <div className="notice-actions">
          {locked ? (
            <Button asChild size="lg">
              <Link href="/shop">{upsell("cta")}</Link>
            </Button>
          ) : null}
          <Button asChild size="lg" variant="outline">
            <Link href="/profile">{t("back")}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
