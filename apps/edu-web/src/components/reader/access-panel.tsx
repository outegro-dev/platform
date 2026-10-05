import type { BookAccess, ChapterAccess } from "@outegro/contracts/edu";
import { type FullAccess, isFullAccess } from "@outegro/edu-engine";
import { Button } from "@outegro/ui/button";
import { hostOf } from "@outegro/ui/lib/platform";
import { Surface } from "@outegro/ui/surface";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
  SignInIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { platformUrls } from "@/lib/env";
import { offerForBook } from "@/lib/offer";
import { signInHref } from "@/lib/routes";

type Access = BookAccess | ChapterAccess;
type Rule = { features: readonly string[]; previewChapters: number };

/** The whole book is open to the reader, and why. */
async function AccessNote({ access }: { access: FullAccess }) {
  const t = await getTranslations("access");
  return (
    <p className="access-note" data-testid="access-note">
      <CheckCircleIcon aria-hidden="true" weight="fill" />
      {t(access)}
    </p>
  );
}

/** What signing in opens: the free chapters of a paid book, or all of it. */
async function signInText({ features, previewChapters }: Rule) {
  const t = await getTranslations("access");
  return features.length && previewChapters > 0
    ? t("signInPreview", { count: previewChapters })
    : t("signInBody");
}

/**
 * One line under a book's title on what the reader may read: open to them,
 * or what signing in opens (the hero's button signs in). Without access the
 * book page shows the full AccessPanel instead.
 */
export async function AccessSummary({
  access,
  ...rule
}: Rule & { access: BookAccess }) {
  if (isFullAccess(access)) return <AccessNote access={access} />;
  if (access === "sign_in")
    return <p className="access-hint">{await signInText(rule)}</p>;
  return null;
}

/**
 * Why a reader can or cannot read, and what to do about it: sign in, get
 * access (a product on pay.outegro.dev once the catalog has one; until
 * then, an invitation through the contact form), or nothing at all.
 */
export async function AccessPanel({
  access,
  path,
  headingLevel = 2,
  title,
  ...rule
}: Rule & {
  access: Access;
  /** This page, for the way back after sign-in or payment. */
  path: string;
  headingLevel?: 2 | 3;
  /** Replaces the panel's own title (e.g. on a closed chapter). */
  title?: string;
}) {
  if (isFullAccess(access)) return <AccessNote access={access} />;
  const t = await getTranslations("access");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const signIn = access === "sign_in";
  const offer = signIn ? null : await offerForBook(rule.features, path);
  return (
    <Surface
      className="access-panel"
      data-testid="access-panel"
      data-access={signIn ? "sign_in" : "locked"}
    >
      <Heading className="access-title">
        {title ?? (signIn ? t("signInTitle") : t("lockedTitle"))}
      </Heading>
      {signIn ? (
        <p>{await signInText(rule)}</p>
      ) : (
        <>
          <p>
            {rule.previewChapters > 0
              ? t("lockedPreview", { count: rule.previewChapters })
              : t("lockedBody")}
          </p>
          <p>
            {offer?.kind === "catalog"
              ? t("catalog", {
                  host: hostOf(platformUrls.pay) ?? "pay.outegro.dev",
                })
              : t("invitation")}
          </p>
        </>
      )}
      <div className="access-actions">
        <Button asChild size="lg">
          {offer ? (
            <a
              href={offer.href}
              data-testid="access-offer"
              data-offer={offer.kind}
            >
              {offer.kind === "catalog" ? (
                <KeyIcon aria-hidden="true" />
              ) : (
                <EnvelopeSimpleIcon aria-hidden="true" />
              )}
              {offer.kind === "catalog" ? t("catalogCta") : t("invitationCta")}
              <ArrowSquareOutIcon aria-hidden="true" />
            </a>
          ) : (
            <a href={signInHref(path)} data-testid="access-sign-in">
              <SignInIcon aria-hidden="true" />
              {t("signInCta")}
            </a>
          )}
        </Button>
      </div>
    </Surface>
  );
}
