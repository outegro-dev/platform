import { Button } from "@outegro/ui/button";
import { StatePanel } from "@outegro/ui/notice";
import {
  ArrowClockwiseIcon,
  CloudSlashIcon,
  LockKeyIcon,
  SignOutIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Brand } from "@/components/chrome/brand";
import type { Viewer } from "@/lib/api";
import { env } from "@/lib/env";

/**
 * A page outside the app's shell (no access, signed out, Identity down):
 * the wordmark over a sheet of paper.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-frame">
      <header className="auth-frame-head">
        <Brand />
      </header>
      <main id="main" className="auth-frame-main">
        {children}
      </main>
    </div>
  );
}

/** atelier-backend did not answer (or answered outside the contract). */
export async function Unavailable({
  retryHref,
  size = "md",
  headingLevel = 2,
}: {
  retryHref: string;
  size?: "sm" | "md";
  headingLevel?: 1 | 2 | 3;
}) {
  const t = await getTranslations("unavailable");
  return (
    <StatePanel
      className={size === "md" ? "min-h-[50vh]" : "min-h-[240px]"}
      size={size}
      tone="danger"
      headingLevel={headingLevel}
      icon={<CloudSlashIcon aria-hidden="true" />}
      title={t("title")}
      description={t("body")}
      actions={
        <Button asChild size="md" variant="outline">
          <a href={retryHref}>
            <ArrowClockwiseIcon aria-hidden="true" />
            {t("retry")}
          </a>
        </Button>
      }
    />
  );
}

/** Signed in, but without `atelier.use`: say so politely, offer sign-out. */
export async function NoAccess({ viewer }: { viewer: Viewer }) {
  const t = await getTranslations("noAccess");
  return (
    <AuthFrame>
      <StatePanel
        className="min-h-[56vh]"
        headingLevel={1}
        icon={<LockKeyIcon aria-hidden="true" />}
        title={t("title")}
        description={t("body", {
          who: viewer.email ?? viewer.displayName ?? viewer.id,
        })}
        actions={
          <>
            <form method="post" action="/auth/sign-out">
              <Button type="submit" variant="outline" size="md">
                <SignOutIcon aria-hidden="true" />
                {t("signOut")}
              </Button>
            </form>
            <Button asChild variant="ghost" size="md">
              <a href={env.SITE_URL}>{t("site")}</a>
            </Button>
          </>
        }
      />
    </AuthFrame>
  );
}

/** Identity did not answer: nothing can be shown until it does. */
export async function IdentityDown({ retryHref }: { retryHref: string }) {
  const t = await getTranslations("identity");
  const retry = await getTranslations("errors");
  return (
    <AuthFrame>
      <StatePanel
        className="min-h-[56vh]"
        tone="danger"
        headingLevel={1}
        live="assertive"
        icon={<CloudSlashIcon aria-hidden="true" />}
        title={t("title")}
        description={t("body")}
        actions={
          <Button asChild size="md">
            <a href={retryHref}>
              <ArrowClockwiseIcon aria-hidden="true" />
              {retry("retry")}
            </a>
          </Button>
        }
      />
    </AuthFrame>
  );
}
