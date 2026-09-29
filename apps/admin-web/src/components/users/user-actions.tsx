import {
  ArrowCounterClockwiseIcon,
  ProhibitIcon,
  SignOutIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import {
  revokeUserSessions,
  setUserStatus,
} from "@/app/(console)/users/actions";
import { ActionDialog } from "@/components/ui/action-dialog";
import type { AdminUser } from "@/lib/adapters/identity";

/** Header commands of the user card, shown only to roles that may run them. */
export async function UserActions({
  user,
  activeSessions,
  granted,
  name,
}: {
  user: AdminUser;
  activeSessions: number;
  granted: ReadonlySet<string>;
  name: string;
}) {
  const t = await getTranslations("users.actions");
  return (
    <>
      {granted.has("sessions.revoke") && (
        <ActionDialog
          action={revokeUserSessions}
          triggerLabel={t("revokeSessions")}
          triggerIcon={<SignOutIcon aria-hidden="true" />}
          title={t("revokeSessionsTitle")}
          description={t("revokeSessionsDescription", { name })}
          consequences={[
            t("revokeSessionsEffect", { count: activeSessions }),
            t("revokeSessionsStays"),
            t("audited"),
          ]}
          confirmLabel={t("revokeSessionsConfirm")}
          destructive
          hidden={{ userId: user.id }}
        />
      )}
      {granted.has("users.suspend") &&
        (user.status === "suspended" ? (
          <ActionDialog
            action={setUserStatus}
            triggerLabel={t("restore")}
            triggerVariant="primary"
            triggerIcon={<ArrowCounterClockwiseIcon aria-hidden="true" />}
            title={t("restoreTitle")}
            description={t("restoreDescription", { name })}
            consequences={[
              t("restoreEffect"),
              t("restoreSessions"),
              t("audited"),
            ]}
            confirmLabel={t("restoreConfirm")}
            hidden={{ userId: user.id, status: "active" }}
          />
        ) : user.status === "active" ? (
          <ActionDialog
            action={setUserStatus}
            triggerLabel={t("suspend")}
            triggerVariant="destructive"
            triggerIcon={<ProhibitIcon aria-hidden="true" />}
            title={t("suspendTitle")}
            description={t("suspendDescription", { name })}
            consequences={[
              t("suspendEffect"),
              t("suspendSessions", { count: activeSessions }),
              t("suspendSubscriptions"),
              t("audited"),
            ]}
            confirmLabel={t("suspendConfirm")}
            destructive
            hidden={{ userId: user.id, status: "suspended" }}
          />
        ) : null)}
    </>
  );
}
