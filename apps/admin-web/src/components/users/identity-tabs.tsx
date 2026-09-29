import { platformRoles } from "@outegro/contracts";
import { Input } from "@outegro/ui/input";
import {
  PlusIcon,
  SignOutIcon,
  UserMinusIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import {
  grantRole,
  revokeRole,
  revokeUserSessions,
} from "@/app/(console)/users/actions";
import { Actor } from "@/components/audit/actor";
import { ActionDialog } from "@/components/ui/action-dialog";
import { CopyText } from "@/components/ui/copy-text";
import { DataTable, Time } from "@/components/ui/data";
import { Facts, Panel, Stat, Status } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import type { UserDetail } from "@/lib/adapters/identity";
import { maskEmail } from "@/lib/format";
import { getLabels } from "@/lib/labels";
import { toneOf } from "@/lib/tones";

export async function ProfileTab({
  detail,
  sensitive,
}: {
  detail: UserDetail;
  sensitive: boolean;
}) {
  const t = await getTranslations("users.profile");
  const label = await getLabels();
  const { user } = detail;
  const activeRoles = detail.roleBindings.filter((b) => b.state === "active");
  return (
    <div className="grid-main">
      <Panel id="profile" title={t("title")}>
        <Facts
          cols={2}
          items={[
            { label: t("id"), value: <CopyText value={user.id} /> },
            {
              label: t("email"),
              value: (
                <span className="mono">
                  {sensitive ? user.email : maskEmail(user.email)}
                </span>
              ),
            },
            {
              label: t("displayName"),
              value: user.displayName ?? (
                <span className="muted">{t("none")}</span>
              ),
            },
            { label: t("language"), value: label("locale", user.locale) },
            {
              label: t("status"),
              value: (
                <Status tone={toneOf("user", user.status)}>
                  {label("userStatus", user.status)}
                </Status>
              ),
            },
            {
              label: t("verified"),
              value: user.emailVerified ? t("verifiedYes") : t("verifiedNo"),
            },
            { label: t("created"), value: <Time iso={user.createdAt} /> },
            {
              label: t("version"),
              value: <span className="mono">v{user.version}</span>,
            },
          ]}
        />
        {!sensitive && <p className="small muted">{t("maskedNote")}</p>}
      </Panel>
      <Panel id="summary" title={t("summary")}>
        <div className="stats">
          <Stat label={t("sessions")} value={detail.activeSessions} />
          <Stat label={t("roles")} value={activeRoles.length} />
          <Stat label={t("grants")} value={detail.grants.length} />
        </div>
        {activeRoles.length > 0 && (
          <div className="row-gap">
            {activeRoles.map((binding) => (
              <span key={binding.id} className="chip" data-tone="solid">
                {label("role", binding.role)}
              </span>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export async function SessionsTab({
  detail,
  granted,
  name,
}: {
  detail: UserDetail;
  granted: ReadonlySet<string>;
  name: string;
}) {
  const t = await getTranslations("users.sessions");
  const actions = await getTranslations("users.actions");
  const count = detail.activeSessions;
  return (
    <Panel id="sessions" title={t("title")} note={t("note")}>
      <div className="stats">
        <Stat label={t("active")} value={count} size="lg" hint={t("hint")} />
      </div>
      <p className="state-body">
        {count > 0 ? t("body", { count }) : t("none")}
      </p>
      {granted.has("sessions.revoke") && count > 0 && (
        <div className="row-gap">
          <ActionDialog
            action={revokeUserSessions}
            triggerLabel={actions("revokeSessions")}
            triggerIcon={<SignOutIcon aria-hidden="true" />}
            title={actions("revokeSessionsTitle")}
            description={actions("revokeSessionsDescription", { name })}
            consequences={[
              actions("revokeSessionsEffect", { count }),
              actions("revokeSessionsStays"),
              actions("audited"),
            ]}
            confirmLabel={actions("revokeSessionsConfirm")}
            destructive
            hidden={{ userId: detail.user.id }}
          />
        </div>
      )}
    </Panel>
  );
}

export async function RolesTab({
  detail,
  granted,
  name,
}: {
  detail: UserDetail;
  granted: ReadonlySet<string>;
  name: string;
}) {
  const t = await getTranslations("users.roles");
  const label = await getLabels();
  const canAssign = granted.has("roles.assign");
  const active = new Set(
    detail.roleBindings.filter((b) => b.state === "active").map((b) => b.role),
  );
  const available = Object.keys(platformRoles).filter(
    (role) => !active.has(role),
  );
  const grantDialog = canAssign && available.length > 0 && (
    <ActionDialog
      action={grantRole}
      triggerLabel={t("grant")}
      triggerVariant="primary"
      triggerIcon={<PlusIcon aria-hidden="true" />}
      title={t("grantTitle")}
      description={t("grantDescription", { name })}
      consequences={[t("grantEffect"), t("grantFresh"), t("audited")]}
      confirmLabel={t("grantConfirm")}
      hidden={{ userId: detail.user.id }}
    >
      <div className="field">
        <label className="field-label" htmlFor="grant-role">
          {t("role")}
        </label>
        <select
          id="grant-role"
          name="role"
          className="select"
          required
          defaultValue=""
        >
          <option value="" disabled>
            {t("chooseRole")}
          </option>
          {available.map((role) => (
            <option key={role} value={role}>
              {label("role", role)} —{" "}
              {t("permissionCount", {
                count:
                  (platformRoles as Record<string, readonly string[]>)[role]
                    ?.length ?? 0,
              })}
            </option>
          ))}
        </select>
        <span className="field-hint">{t("roleHint")}</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="grant-expires">
          {t("expires")}
        </label>
        <Input id="grant-expires" name="expiresAt" type="date" />
        <span className="field-hint">{t("expiresHint")}</span>
      </div>
    </ActionDialog>
  );

  return (
    <div className="stack">
      <Panel
        flush
        id="roles"
        title={t("title")}
        note={t("note")}
        action={grantDialog || undefined}
      >
        {detail.roleBindings.length === 0 ? (
          <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
        ) : (
          <DataTable label={t("title")}>
            <thead>
              <tr>
                <th scope="col">{t("colRole")}</th>
                <th scope="col">{t("colState")}</th>
                <th scope="col">{t("colReason")}</th>
                <th scope="col">{t("colGranted")}</th>
                <th scope="col">{t("colExpires")}</th>
                {canAssign && (
                  <th scope="col">
                    <span className="sr-only">{t("colActions")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {detail.roleBindings.map((binding) => (
                <tr key={binding.id}>
                  <td data-primary="">
                    <span className="cell-main">
                      {label("role", binding.role)}
                    </span>
                    <span className="cell-sub mono">{binding.scope}</span>
                  </td>
                  <td data-label={t("colState")}>
                    <Status tone={toneOf("binding", binding.state)}>
                      {label("bindingState", binding.state)}
                    </Status>
                  </td>
                  <td data-label={t("colReason")}>
                    <span className="cell-sub" style={{ marginTop: 0 }}>
                      {binding.reason}
                    </span>
                  </td>
                  <td data-label={t("colGranted")}>
                    <Time iso={binding.createdAt} />
                    {binding.grantedBy && (
                      <span className="cell-sub">
                        {t("by")}{" "}
                        <Actor id={binding.grantedBy} className="above" />
                      </span>
                    )}
                  </td>
                  <td data-label={t("colExpires")}>
                    {binding.state === "revoked" ? (
                      <span className="cell-sub" style={{ marginTop: 0 }}>
                        {t("revokedAt")} <Time iso={binding.revokedAt} />
                      </span>
                    ) : binding.expiresAt ? (
                      <Time iso={binding.expiresAt} format="date" />
                    ) : (
                      <span className="muted">{t("never")}</span>
                    )}
                  </td>
                  {canAssign && (
                    <td data-label={t("colActions")} className="num">
                      {binding.state === "active" && (
                        <ActionDialog
                          action={revokeRole}
                          triggerLabel={t("revoke")}
                          triggerVariant="ghost"
                          triggerIcon={<UserMinusIcon aria-hidden="true" />}
                          title={t("revokeTitle", {
                            role: label("role", binding.role),
                          })}
                          description={t("revokeDescription", { name })}
                          consequences={[
                            t("revokeEffect"),
                            ...(binding.role === "owner"
                              ? [t("revokeOwner")]
                              : []),
                            t("audited"),
                          ]}
                          confirmLabel={t("revokeConfirm")}
                          destructive
                          hidden={{ bindingId: binding.id, role: binding.role }}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
      <Panel
        id="role-reference"
        title={t("reference")}
        note={t("referenceNote")}
      >
        <ul className="stack-sm">
          {Object.entries(platformRoles).map(([role, list]) => (
            <li key={role} className="row-gap">
              <span
                className="chip"
                data-tone={active.has(role) ? "solid" : undefined}
              >
                {label("role", role)}
              </span>
              <span className="small muted">
                {(list as readonly string[]).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
