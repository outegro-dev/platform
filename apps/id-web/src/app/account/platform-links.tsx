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
  ReceiptIcon,
  WrenchIcon,
} from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
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
