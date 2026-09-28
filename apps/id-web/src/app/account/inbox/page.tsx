import { BackendError } from "@outegro/bff/backend";
import { Button } from "@outegro/ui/button";
import { Surface } from "@outegro/ui/surface";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { type InboxPage, notificationsApi, withSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { markRead } from "../actions";

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
    <>
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p>{t("lead")}</p>
        <p className="og-eyebrow">
          {t("unread", { count: inbox.unreadCount })}
        </p>
      </header>
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
                <div className="row-main">
                  <p className="row-title">
                    {!item.readAt && (
                      <span className="unread-dot" aria-hidden="true" />
                    )}
                    {item.title}
                  </p>
                  <p className="row-body">{item.body}</p>
                  <p className="muted small">
                    {formatDate(item.createdAt, locale)}
                  </p>
                </div>
                {!item.readAt && (
                  <form action={markRead}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("markRead")}
                    </Button>
                  </form>
                )}
              </Surface>
            </li>
          ))}
        </ul>
      )}
      {(cursor || inbox.nextCursor) && (
        <nav className="pager" aria-label={t("title")}>
          {cursor && (
            <Button asChild variant="ghost">
              <a href="/account/inbox">{t("latest")}</a>
            </Button>
          )}
          {inbox.nextCursor && (
            <Button asChild variant="outline">
              <a
                href={`/account/inbox?cursor=${encodeURIComponent(inbox.nextCursor)}`}
              >
                {t("older")}
              </a>
            </Button>
          )}
        </nav>
      )}
    </>
  );
}
