import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import { FailureState, ForbiddenPage } from "@/components/ui/states";
import type { Operator } from "./adapters/identity";
import type { Permission } from "./permissions";
import { currentPath, signInPath } from "./request";
import { getOperator } from "./server";

export type Access =
  | { ok: true; operator: Operator; granted: ReadonlySet<string> }
  | { ok: false; element: ReactElement };

/**
 * Server-side gate of every page: a missing session goes to sign-in, a
 * missing permission renders "forbidden" (and the service would refuse the
 * call anyway). The operator comes fresh from Identity once per request.
 */
export async function pageAccess(
  permission: Permission | null,
): Promise<Access> {
  const me = await getOperator();
  if (!me.ok) {
    if (me.kind === "unauthenticated")
      redirect(signInPath(await currentPath()));
    const t = await getTranslations("states");
    return {
      ok: false,
      element: <FailureState failure={me} what={t("yourAccess")} size="page" />,
    };
  }
  const granted = new Set(me.data.permissions);
  if (permission && !granted.has(permission)) {
    return { ok: false, element: <ForbiddenPage permission={permission} /> };
  }
  return { ok: true, operator: me.data, granted };
}
