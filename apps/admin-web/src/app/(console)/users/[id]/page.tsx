import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { initials } from "@/components/shell/console-shell";
import { CopyText } from "@/components/ui/copy-text";
import { Time } from "@/components/ui/data";
import { PageHeader, Panel, SectionTabs, Status } from "@/components/ui/layout";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import {
  ProfileTab,
  RolesTab,
  SessionsTab,
} from "@/components/users/identity-tabs";
import {
  AccessTab,
  ActivityTab,
  BattleshipTab,
  EducationTab,
  NotificationsTab,
  PaymentsTab,
} from "@/components/users/service-tabs";
import { UserActions } from "@/components/users/user-actions";
import { pageAccess } from "@/lib/access";
import { maskEmail, shortId } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { oneOf, type Params, type SearchParams } from "@/lib/params";
import { type UserTab, userTabsFor } from "@/lib/permissions";
import { userDetail } from "@/lib/queries";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("cardTitle") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who this user is and why they have (or lack) access: one card with a tab
 * per service. A tab whose service is down says so; it never shows zeros.
 */
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Params<"id">;
  searchParams: SearchParams;
}) {
  const access = await pageAccess("users.read");
  if (!access.ok) return access.element;
  const { id } = await params;
  const query = await searchParams;
  const t = await getTranslations("users");
  const label = await getLabels();
  const crumbs = [{ href: "/users", label: t("title") }];

  const detail = UUID.test(id)
    ? await userDetail(id)
    : ({ ok: false, kind: "not-found" } as const);
  if (!detail.ok) {
    return (
      <div className="page">
        <PageHeader crumbs={crumbs} title={t("cardTitle")} />
        <Panel>
          <FailureState failure={detail} what={t("thisUser")} />
        </Panel>
      </div>
    );
  }

  const { user } = detail.data;
  const { granted } = access;
  const sensitive = granted.has("users.read.sensitive");
  const email = sensitive ? user.email : (maskEmail(user.email) ?? "");
  const name = user.displayName || email;
  const tabs = userTabsFor(granted);
  const tab: UserTab = oneOf(query, "tab", tabs) ?? "profile";

  return (
    <div className="page">
      <PageHeader
        crumbs={crumbs}
        title={
          <span className="identity">
            <span className="avatar" aria-hidden="true">
              {initials(user)}
            </span>
            <span>{name}</span>
          </span>
        }
        lead={
          <span className="row-gap">
            <Status tone={toneOf("user", user.status)}>
              {label("userStatus", user.status)}
            </Status>
            {user.displayName && <span className="mono">{email}</span>}
            <CopyText
              value={user.id}
              display={shortId(user.id)}
              label={t("copyId")}
            />
            <span className="small">
              {t("joined")} <Time iso={user.createdAt} format="date" />
            </span>
          </span>
        }
        actions={
          <UserActions
            user={user}
            activeSessions={detail.data.activeSessions}
            granted={granted}
            name={name}
          />
        }
      />
      <SectionTabs
        label={t("tabsLabel")}
        active={tab}
        items={tabs.map((key) => ({
          key,
          href: key === "profile" ? `/users/${id}` : `/users/${id}?tab=${key}`,
          label: t(`tabs.${key}`),
          count:
            key === "roles"
              ? detail.data.roleBindings.filter((b) => b.state === "active")
                  .length
              : key === "sessions"
                ? detail.data.activeSessions
                : undefined,
        }))}
      />
      <Suspense
        key={tab}
        fallback={
          <PanelSkeleton
            className="h-panel-sm"
            label={t(`tabs.${tab}`)}
            stats={3}
            rows={4}
          />
        }
      >
        {tab === "profile" && (
          <ProfileTab detail={detail.data} sensitive={sensitive} />
        )}
        {tab === "sessions" && (
          <SessionsTab detail={detail.data} granted={granted} name={name} />
        )}
        {tab === "roles" && (
          <RolesTab detail={detail.data} granted={granted} name={name} />
        )}
        {tab === "access" && (
          <AccessTab detail={detail.data} granted={granted} name={name} />
        )}
        {tab === "notifications" && <NotificationsTab userId={user.id} />}
        {tab === "battleship" && <BattleshipTab userId={user.id} />}
        {tab === "education" && <EducationTab userId={user.id} />}
        {tab === "payments" && <PaymentsTab userId={user.id} />}
        {tab === "activity" && <ActivityTab userId={user.id} />}
      </Suspense>
    </div>
  );
}
