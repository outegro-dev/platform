import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { pageAccess } from "@/lib/access";
import { type Permission, sectionTabs, tabsFor } from "@/lib/permissions";
import { PageHeader } from "./layout";
import { SectionNav } from "./section-nav";

/** Header and tabs shared by the pages of one console section. */
export async function SectionFrame({
  section,
  permission,
  children,
}: {
  section: keyof typeof sectionTabs;
  permission: Permission;
  children: ReactNode;
}) {
  const access = await pageAccess(permission);
  if (!access.ok) return access.element;
  const t = await getTranslations(section);
  const tabs = tabsFor(access.granted, sectionTabs[section]);
  return (
    <div className="page">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} lead={t("lead")} />
      <SectionNav
        label={t("tabsLabel")}
        items={tabs.map((tab) => ({
          key: tab.key,
          href: tab.href,
          label: t(`tabs.${tab.key}`),
        }))}
      />
      {children}
    </div>
  );
}
