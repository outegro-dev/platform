import { Button } from "@outegro/ui/button";
import { LockKeyIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { StateView } from "@/components/ui/states";
import type { Operator } from "@/lib/adapters/identity";
import { AuthFrame } from "./auth-frame";

/** Signed in, but no admin role: say so, and offer to sign out. */
export async function NoAccess({ operator }: { operator: Operator }) {
  const t = await getTranslations("noAccess");
  const signOut = (
    <form method="post" action="/auth/sign-out">
      <Button type="submit" variant="outline" size="md">
        <SignOutIcon aria-hidden="true" />
        {t("signOut")}
      </Button>
    </form>
  );
  return (
    <AuthFrame>
      <StateView
        kind="forbidden"
        size="page"
        icon={<LockKeyIcon />}
        title={t("title")}
        body={t("body", { email: operator.email })}
        extra={<p className="state-body">{t("hint")}</p>}
        actions={signOut}
      />
    </AuthFrame>
  );
}
