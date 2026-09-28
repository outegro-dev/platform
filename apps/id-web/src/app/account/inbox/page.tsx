import { Button } from "@outegro/ui/button";
import { Surface } from "@outegro/ui/surface";
import { getLocale, getTranslations } from "next-intl/server";
import { type InboxPage, notificationsApi, withSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { markRead } from "../actions";

export default async function InboxRoute() {
  const t = await getTranslations("inbox");
  const locale = await getLocale();
  const inbox = await withSession("/account/inbox", (token) =>
    notificationsApi<InboxPage>("/v1/me/inbox?limit=50", {
      accessToken: token,
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
    </>
  );
}
