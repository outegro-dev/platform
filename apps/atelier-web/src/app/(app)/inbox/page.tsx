import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InboxView } from "@/components/inbox/inbox-view";
import { Unavailable } from "@/components/ui/states";
import { loadInbox } from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inbox");
  return { title: t("title") };
}

/** New matches and tasks: the morning's first two minutes. */
export default async function InboxPage() {
  const t = await getTranslations("inbox");
  const loaded = await loadInbox();
  return (
    <main id="main" className="page page-narrow">
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p className="page-lead">{t("lead")}</p>
      </header>
      {loaded.status === "ok" ? (
        <InboxView inbox={loaded.data} now={Date.now()} />
      ) : (
        <Unavailable retryHref="/inbox" />
      )}
    </main>
  );
}
