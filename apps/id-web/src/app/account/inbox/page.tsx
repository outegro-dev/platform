import { BackendError } from "@outegro/bff/backend";
import { Surface } from "@outegro/ui/surface";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHead } from "@/components/page-head";
import { type InboxPage, notificationsApi, withSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { InboxActions, MarkReadForm, PagerLink } from "./inbox-actions";

const PAGE_SIZE = 20;
const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inbox");
  return { title: t("title") };
}

export default async function InboxRoute({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const t = await getTranslations("inbox");
  const locale = await getLocale();
  const raw = (await searchParams).cursor;
  const cursor =
    raw === undefined ? undefined : cursorSchema.safeParse(raw).data;
  if (raw !== undefined && !cursor) redirect("/account/inbox");
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  const inbox = await withSession("/account/inbox", (token) =>
    notificationsApi<InboxPage>(`/v1/me/inbox?${query}`, {
      accessToken: token,
    }).catch((error) => {
      // A stale or edited cursor starts over from the newest messages.
      if (
        cursor &&
        error instanceof BackendError &&
        error.error.code === "VALIDATION_FAILED"
      ) {
        redirect("/account/inbox");
      }
      throw error;
    }),
  );
  return (
    <InboxActions>
      <PageHead title={t("title")} lead={t("lead")}>
        <p className="og-eyebrow">
          {t("unread", { count: inbox.unreadCount })}
        </p>
      </PageHead>
      {inbox.items.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="list">
          {inbox.items.map((item) => (
            <li key={item.id}>
              <Surface
                className="row"
                data-unread={item.readAt ? undefined : ""}
              >
                {/* In the row's gutter: reading it moves no text. */}
                <span className="unread-dot" aria-hidden="true" />
                <div className="row-main">
                  <p className="row-title">
                    {!item.readAt && (
                      <span className="sr-only">{t("unreadItem")}: </span>
                    )}
                    {item.title}
                  </p>
                  <p className="row-body">{item.body}</p>
                  <p className="muted small">
                    {formatDate(item.createdAt, locale)}
                  </p>
                </div>
                <MarkReadForm itemId={item.id} read={Boolean(item.readAt)} />
              </Surface>
            </li>
          ))}
        </ul>
      )}
      {(cursor || inbox.nextCursor) && (
        <nav className="pager" aria-label={t("pages")}>
          {cursor && (
            <PagerLink href="/account/inbox" variant="ghost">
              {t("latest")}
            </PagerLink>
          )}
          {inbox.nextCursor && (
            <PagerLink
              href={`/account/inbox?cursor=${encodeURIComponent(inbox.nextCursor)}`}
              variant="outline"
            >
              {t("older")}
            </PagerLink>
          )}
        </nav>
      )}
    </InboxActions>
  );
}
