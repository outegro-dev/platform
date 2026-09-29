import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataTable, Pager, Time } from "@/components/ui/data";
import { Panel, Status } from "@/components/ui/layout";
import { EmptyState, FailureState } from "@/components/ui/states";
import { maskEmail } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function UsersTable({
  query,
  cursor,
  sensitive,
}: {
  query?: string;
  cursor?: string;
  sensitive: boolean;
}) {
  const t = await getTranslations("users");
  const label = await getLabels();
  const result = await load(() =>
    services().identity.users({ query, cursor, limit: 25 }),
  );
  if (!result.ok) {
    return (
      <Panel>
        <FailureState failure={result} what={t("what")} />
      </Panel>
    );
  }
  const { items, nextCursor } = result.data;
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          search={Boolean(query)}
          title={query ? t("noMatchTitle", { query }) : t("emptyTitle")}
          body={query ? t("noMatchBody") : t("emptyBody")}
        />
      </Panel>
    );
  }
  return (
    <Panel
      flush
      id="users-list"
      title={query ? t("resultsFor", { query }) : t("allUsers")}
      note={sensitive ? undefined : t("maskedNote")}
    >
      <DataTable label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colUser")}</th>
            <th scope="col">{t("colStatus")}</th>
            <th scope="col">{t("colLanguage")}</th>
            <th scope="col">{t("colVerified")}</th>
            <th scope="col">{t("colCreated")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((user) => {
            const email = sensitive ? user.email : maskEmail(user.email);
            return (
              <tr key={user.id}>
                <td data-primary="">
                  <Link
                    href={`/users/${user.id}`}
                    className="row-link cell-main"
                    prefetch={false}
                  >
                    {user.displayName || email}
                  </Link>
                  <span className="cell-sub">
                    {user.displayName ? email : t("noName")}
                  </span>
                </td>
                <td data-label={t("colStatus")}>
                  <Status tone={toneOf("user", user.status)}>
                    {label("userStatus", user.status)}
                  </Status>
                </td>
                <td data-label={t("colLanguage")}>
                  <span className="mono">{user.locale.toUpperCase()}</span>
                </td>
                <td data-label={t("colVerified")}>
                  {user.emailVerified ? t("yes") : t("no")}
                </td>
                <td data-label={t("colCreated")}>
                  <Time iso={user.createdAt} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      <Pager
        path="/users"
        params={{ query, cursor }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </Panel>
  );
}
