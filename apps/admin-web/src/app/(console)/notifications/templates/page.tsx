import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Facts, Panel } from "@/components/ui/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { getLabels } from "@/lib/labels";
import { one, oneOf, type SearchParams } from "@/lib/params";
import { templatesList } from "@/lib/queries";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.templates");
  return { title: t("title") };
}

async function Preview({
  templateKey,
  locale,
}: {
  templateKey: string;
  locale: "en" | "ru";
}) {
  const t = await getTranslations("notifications.templates");
  const result = await load(() =>
    services().notifications.preview(templateKey, locale),
  );
  if (!result.ok)
    return <FailureState failure={result} what={t("previewWhat")} />;
  const preview = result.data;
  return (
    <div className="stack">
      <Facts
        cols={2}
        items={[
          { label: t("subject"), value: <strong>{preview.subject}</strong> },
          {
            label: t("locale"),
            value: <span className="mono">{preview.locale.toUpperCase()}</span>,
          },
        ]}
      />
      <div className="stack-sm">
        <p className="panel-kicker">{t("text")}</p>
        <div className="code">
          <pre className="wrap">{preview.text}</pre>
        </div>
      </div>
      <div className="stack-sm">
        <p className="panel-kicker">{t("html")}</p>
        {/* Sample data only; sandboxed without scripts, forms or navigation. */}
        <iframe
          className="preview-frame"
          title={t("frameTitle", {
            key: preview.key,
            locale: preview.locale.toUpperCase(),
          })}
          sandbox=""
          srcDoc={preview.html}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </div>
    </div>
  );
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await pageAccess("notifications.read");
  if (!access.ok) return access.element;
  const params = await searchParams;
  const t = await getTranslations("notifications.templates");
  const label = await getLabels();
  const f = await getFormatter();
  const templates = await templatesList();
  if (!templates.ok) {
    return (
      <Panel>
        <FailureState failure={templates} what={t("what")} />
      </Panel>
    );
  }
  if (templates.data.length === 0) {
    return (
      <Panel>
        <EmptyState title={t("empty")} />
      </Panel>
    );
  }
  const requested = one(params, "template");
  const selected =
    templates.data.find((template) => template.key === requested) ??
    templates.data[0];
  const locale =
    oneOf(params, "locale", ["en", "ru"] as const) ??
    (f.locale === "ru" ? "ru" : "en");
  if (!selected) return null;
  const href = (key: string, lang: string) =>
    `/notifications/templates?template=${encodeURIComponent(key)}&locale=${lang}`;

  return (
    <div className="grid-split">
      <Panel flush id="template-list" title={t("title")} note={t("lead")}>
        <ul className="feed feed-padded">
          {templates.data.map((template) => (
            <li key={template.key} className="feed-item" data-plain="">
              <span className="feed-main">
                <Link
                  href={href(template.key, locale)}
                  className="feed-title link template-link"
                  aria-current={
                    template.key === selected.key ? "true" : undefined
                  }
                >
                  {template.key}
                </Link>
                <span className="feed-meta">
                  {label("category", template.category)} ·{" "}
                  {template.channels
                    .map((channel) => label("channel", channel))
                    .join(", ")}
                </span>
                {template.mandatory.length > 0 && (
                  <span className="feed-meta">
                    {t("mandatory", {
                      channels: template.mandatory
                        .map((channel) => label("channel", channel))
                        .join(", "),
                    })}
                  </span>
                )}
              </span>
              <span className="feed-time">
                {t("ttl", { time: f.duration(template.ttlMs) })}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        id="template-preview"
        kicker={t("preview")}
        title={selected.key}
        action={
          <nav className="segmented" aria-label={t("localeSwitch")}>
            {(["en", "ru"] as const).map((lang) => (
              <Link
                key={lang}
                href={href(selected.key, lang)}
                aria-current={lang === locale ? "true" : undefined}
                lang={lang}
              >
                {lang.toUpperCase()}
              </Link>
            ))}
          </nav>
        }
      >
        <Suspense
          key={`${selected.key}-${locale}`}
          fallback={
            <div className="stack" aria-busy="true">
              <Skeleton height={44} />
              <Skeleton height={120} />
              <Skeleton height={560} radius={12} />
            </div>
          }
        >
          <Preview templateKey={selected.key} locale={locale} />
        </Suspense>
      </Panel>
    </div>
  );
}
