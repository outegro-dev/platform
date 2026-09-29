import { Button } from "@outegro/ui/button";
import {
  LockIcon,
  MagnifyingGlassIcon,
  PlugIcon,
  SignInIcon,
  TrayIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { currentPath, signInPath } from "@/lib/request";
import type { Failure } from "@/lib/result";
import { RetryButton } from "./retry-button";

type Kind = "empty" | "error" | "forbidden" | "not-connected" | "warning";

export function StateView({
  kind,
  icon,
  title,
  body,
  actions,
  size,
  extra,
}: {
  kind: Kind;
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "page";
  extra?: ReactNode;
}) {
  return (
    <div
      className="state"
      data-kind={kind}
      data-size={size}
      role={kind === "error" ? "alert" : undefined}
    >
      <span className="state-icon" aria-hidden="true">
        {icon}
      </span>
      {size === "page" ? (
        <h1 className="state-title">{title}</h1>
      ) : (
        <p className="state-title">{title}</p>
      )}
      {body && <p className="state-body">{body}</p>}
      {extra}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

/** Nothing to show, and that is the truth (not an outage). */
export function EmptyState({
  title,
  body,
  action,
  size,
  search,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  size?: "sm";
  search?: boolean;
}) {
  return (
    <StateView
      kind="empty"
      icon={search ? <MagnifyingGlassIcon /> : <TrayIcon />}
      title={title}
      body={body}
      actions={action}
      size={size}
    />
  );
}

/**
 * Why there is no data: an outage (retry), no permission, missing record,
 * an ended session, or a service that is not connected yet. Never zeros.
 */
export async function FailureState({
  failure,
  what,
  service,
  size,
}: {
  failure: Failure;
  /** What could not be loaded, lower case: "deliveries", "this user". */
  what: string;
  /** For "not connected": the service's display name. */
  service?: string;
  size?: "sm" | "page";
}) {
  const t = await getTranslations("states");
  switch (failure.kind) {
    case "forbidden":
      return (
        <StateView
          kind="forbidden"
          icon={<LockIcon />}
          title={t("forbiddenTitle", { what })}
          body={t("forbiddenBody")}
          size={size}
        />
      );
    case "not-found":
      return (
        <StateView
          kind="empty"
          icon={<MagnifyingGlassIcon />}
          title={t("notFoundTitle")}
          body={t("notFoundBody", { what })}
          size={size}
        />
      );
    case "unauthenticated": {
      const returnTo = await currentPath();
      return (
        <StateView
          kind="warning"
          icon={<SignInIcon />}
          title={t("sessionTitle")}
          body={t("sessionBody")}
          size={size}
          actions={
            <Button asChild size="sm">
              <a href={signInPath(returnTo)}>{t("signInAgain")}</a>
            </Button>
          }
        />
      );
    }
    case "not-connected":
      return (
        <NotConnectedState
          service={service ?? what}
          reason={failure.reason}
          size={size}
        />
      );
    default:
      return (
        <StateView
          kind="error"
          icon={<WarningCircleIcon />}
          title={t("errorTitle", { what })}
          body={t("errorBody")}
          size={size}
          extra={
            failure.requestId ? (
              <p className="request-id">
                {t("requestId", { id: failure.requestId })}
              </p>
            ) : null
          }
          actions={<RetryButton />}
        />
      );
  }
}

export async function NotConnectedState({
  service,
  reason,
  size,
}: {
  service: string;
  reason: "unconfigured" | "unreachable";
  size?: "sm" | "page";
}) {
  const t = await getTranslations("states");
  return (
    <StateView
      kind="not-connected"
      icon={<PlugIcon />}
      title={t("notConnectedTitle", { service })}
      body={
        reason === "unconfigured"
          ? t("notConnectedUnconfigured", { service })
          : t("notConnectedUnreachable", { service })
      }
      size={size}
      actions={
        reason === "unreachable" ? (
          <RetryButton label={t("checkAgain")} />
        ) : undefined
      }
    />
  );
}

/** A page the operator's role does not open (the server said no, not the UI). */
export async function ForbiddenPage({ permission }: { permission: string }) {
  const t = await getTranslations("states");
  return (
    <StateView
      kind="forbidden"
      icon={<LockIcon />}
      size="page"
      title={t("forbiddenPageTitle")}
      body={t("forbiddenPageBody")}
      extra={
        <p className="request-id">{t("needsPermission", { permission })}</p>
      }
    />
  );
}
