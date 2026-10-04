import { Button } from "@outegro/ui/button";
import {
  hasPlatformRole,
  hostOf,
  pageHref,
  platformHref,
} from "@outegro/ui/lib/platform";
import { Surface } from "@outegro/ui/surface";
import type { Icon } from "@phosphor-icons/react";
import {
  AnchorIcon,
  ArrowUpRightIcon,
  BookOpenTextIcon,
  ReceiptIcon,
  WrenchIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Skeleton, SkeletonText } from "@/components/skeletons";
import { platformUrls } from "@/lib/env";

/**
 * Where the account leads: the apps it signs in to (the admin console only
 * with a platform role) and the purchases and subscriptions on payments,
 * with a way back here.
 */
export async function PlatformLinks({ roles }: { roles: readonly string[] }) {
  const t = await getTranslations("platform");
  const back = pageHref(platformUrls, "account");
  const apps: { key: string; href: string; Icon: Icon }[] = [
    {
      key: "battleship",
      href: platformHref(platformUrls, "battleship"),
      Icon: AnchorIcon,
    },
    {
      key: "edu",
      href: platformHref(platformUrls, "edu"),
      Icon: BookOpenTextIcon,
    },
  ];
  if (hasPlatformRole(roles))
    apps.push({
      key: "admin",
      href: platformHref(platformUrls, "admin"),
      Icon: WrenchIcon,
    });
  return (
    <div className="platform-links">
      <Surface asChild className="panel">
        <section aria-labelledby="apps-title" data-testid="your-apps">
          <div className="panel-head">
            <h2 id="apps-title">{t("appsTitle")}</h2>
            <p className="muted small">{t("appsLead")}</p>
          </div>
          <ul className="app-links">
            {apps.map(({ key, href, Icon }) => (
              <li key={key}>
                <a className="app-link" href={href}>
                  <span className="app-link-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="app-link-text">
                    <span className="app-link-name">{t(`${key}.name`)}</span>
                    <span className="muted small">{t(`${key}.body`)}</span>
                    <span className="mono small">{hostOf(href)}</span>
                  </span>
                  <ArrowUpRightIcon
                    className="app-link-arrow"
                    aria-hidden="true"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </Surface>
      <Surface asChild className="panel">
        <section aria-labelledby="purchases-title" data-testid="purchases">
          <div className="panel-head">
            <h2 id="purchases-title">{t("purchasesTitle")}</h2>
            <p className="muted small">
              {t("purchasesBody", { host: hostOf(platformUrls.pay) ?? "" })}
            </p>
          </div>
          <div className="platform-actions">
            <Button asChild variant="outline">
              <a
                href={pageHref(platformUrls, "purchases", {
                  from: "id",
                  returnTo: back,
                })}
              >
                <ReceiptIcon aria-hidden="true" />
                {t("purchases")}
                <ArrowUpRightIcon aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a
                href={pageHref(platformUrls, "subscriptions", {
                  from: "id",
                  returnTo: back,
                })}
              >
                {t("subscriptions")}
                <ArrowUpRightIcon aria-hidden="true" />
              </a>
            </Button>
          </div>
        </section>
      </Surface>
    </div>
  );
}

/**
 * The same two panels while the profile loads: the headings are known, the
 * app rows (the admin console depends on the roles) and the links are not.
 * A placeholder row stands for each app every account has (Battleship and
 * Education). Without it the loaded page grows by both panels at once.
 */
export function PlatformLinksSkeleton() {
  const t = useTranslations("platform");
  return (
    <div className="platform-links" aria-hidden="true">
      <Surface asChild className="panel">
        <section>
          <div className="panel-head">
            <h2>{t("appsTitle")}</h2>
            <p className="muted small">{t("appsLead")}</p>
          </div>
          <ul className="app-links">
            {[0, 1].map((row) => (
              <li key={row} className="app-link">
                <Skeleton className="size-11 rounded-md" />
                <span className="app-link-text">
                  <span className="app-link-name">
                    <SkeletonText className="w-28" />
                  </span>
                  <span className="muted small">
                    <SkeletonText className="w-full max-w-56" />
                    <br />
                    <SkeletonText className="w-24" />
                  </span>
                  <span className="mono small">
                    <SkeletonText className="w-36" />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </Surface>
      <Surface asChild className="panel">
        <section>
          <div className="panel-head">
            <h2>{t("purchasesTitle")}</h2>
            <p className="muted small">
              {t("purchasesBody", { host: hostOf(platformUrls.pay) ?? "" })}
            </p>
          </div>
          <div className="platform-actions">
            <Skeleton className="h-12 w-54 rounded-full" />
            <Skeleton className="h-12 w-50 rounded-full" />
          </div>
        </section>
      </Surface>
    </div>
  );
}
