import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthFrame } from "@/components/shell/auth-frame";
import { ConsoleShell } from "@/components/shell/console-shell";
import { NoAccess } from "@/components/shell/no-access";
import { FailureState } from "@/components/ui/states";
import { hasConsoleAccess } from "@/lib/permissions";
import { currentPath, signInPath } from "@/lib/request";
import { getOperator } from "@/lib/server";

/**
 * Every console page: the operator comes fresh from Identity; without a
 * single admin permission they get "no access" with a sign-out, never an
 * empty console. Pages check their own permission on top of this.
 */
export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getOperator();
  if (!me.ok) {
    if (me.kind === "unauthenticated")
      redirect(signInPath(await currentPath()));
    const t = await getTranslations("states");
    return (
      <AuthFrame>
        <FailureState failure={me} what={t("yourAccess")} size="page" />
      </AuthFrame>
    );
  }
  if (!hasConsoleAccess(me.data.permissions)) {
    return <NoAccess operator={me.data} />;
  }
  return <ConsoleShell operator={me.data}>{children}</ConsoleShell>;
}
