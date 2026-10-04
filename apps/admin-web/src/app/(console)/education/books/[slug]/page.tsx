import {
  ArchiveIcon,
  EyeIcon,
  LockKeyIcon,
  PencilSimpleLineIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  setBookAccess,
  setBookStatus,
} from "@/app/(console)/education/actions";
import { AuditFeed } from "@/components/audit/audit-feed";
import { AccessRuleFields } from "@/components/education/access-fields";
import { getRuleWords } from "@/components/education/access-rule";
import { ReadersTable } from "@/components/education/readers-table";
import { ActionDialog } from "@/components/ui/action-dialog";
import { DataTable, Time } from "@/components/ui/data";
import {
  BackLink,
  Facts,
  Panel,
  PanelLink,
  Stat,
  Status,
} from "@/components/ui/layout";
import { PanelSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { pageAccess } from "@/lib/access";
import { type BookView, isBookSlug } from "@/lib/adapters/edu";
import {
  accessModes,
  featurePresets,
  grantTargetOf,
  presetOf,
} from "@/lib/education";
import { getLabels } from "@/lib/labels";
import type { Params } from "@/lib/params";
import { getFormatter } from "@/lib/request";
import { load } from "@/lib/result";
import { services } from "@/lib/server";
import { toneOf } from "@/lib/tones";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("education.book");
  return { title: t("title") };
}

/** Status and access commands; each dialog renews with the book's version. */
async function BookCommands({
  book,
  chapters,
}: {
  book: BookView;
  chapters: number;
}) {
  const t = await getTranslations("education.book");
  const presetLabel = await getTranslations("education.rule.presets");
  const words = await getRuleWords();
  const rule = words(book.rule, book.slug);
  const status = (value: BookView["status"]) => ({
    slug: book.slug,
    status: value,
    expectedVersion: String(book.version),
  });
  const keeps = t("keepsProgress");
  return (
    <div className="row-gap">
      {book.status !== "published" && (
        <ActionDialog
          key={`published-${book.version}`}
          action={setBookStatus}
          triggerLabel={t("publish")}
          triggerVariant="primary"
          triggerIcon={<EyeIcon aria-hidden="true" />}
          title={t("publishTitle")}
          description={t("publishDescription", { title: book.title })}
          consequences={[
            t("publishEffect"),
            t("publishRule", { rule: `${rule.title} — ${rule.summary}` }),
            t("audited"),
          ]}
          confirmLabel={t("publishConfirm")}
          hidden={status("published")}
        />
      )}
      {book.status !== "draft" && (
        <ActionDialog
          key={`draft-${book.version}`}
          action={setBookStatus}
          triggerLabel={t("draft")}
          triggerIcon={<PencilSimpleLineIcon aria-hidden="true" />}
          title={t("draftTitle")}
          description={t("draftDescription", { title: book.title })}
          consequences={[
            t("draftEffect"),
            t("draftStaff"),
            keeps,
            t("audited"),
          ]}
          confirmLabel={t("draftConfirm")}
          destructive
          hidden={status("draft")}
        />
      )}
      {book.status !== "archived" && (
        <ActionDialog
          key={`archived-${book.version}`}
          action={setBookStatus}
          triggerLabel={t("archive")}
          triggerIcon={<ArchiveIcon aria-hidden="true" />}
          title={t("archiveTitle")}
          description={t("archiveDescription", { title: book.title })}
          consequences={[t("archiveEffect"), keeps, t("audited")]}
          confirmLabel={t("archiveConfirm")}
          destructive
          hidden={status("archived")}
        />
      )}
      <ActionDialog
        key={`access-${book.version}`}
        action={setBookAccess}
        triggerLabel={t("changeAccess")}
        triggerIcon={<LockKeyIcon aria-hidden="true" />}
        title={t("accessTitle")}
        description={t("accessDescription", { title: book.title })}
        consequences={[
          t("accessEffect"),
          t("accessReaders"),
          t("accessGrants"),
          t("audited"),
        ]}
        confirmLabel={t("accessConfirm")}
        hidden={{ slug: book.slug, expectedVersion: String(book.version) }}
      >
        <AccessRuleFields
          mode={book.rule.mode}
          preset={
            (book.rule.mode === "grant" &&
              presetOf(book.rule.features, book.slug)) ||
            "either"
          }
          previewChapters={
            book.rule.mode === "grant" ? book.rule.previewChapters : 1
          }
          chapters={chapters}
          modes={accessModes.map((mode) => ({
            value: mode,
            label: t(`modes.${mode}`),
            hint: t(`modeHints.${mode}`),
          }))}
          presets={featurePresets.map((preset) => ({
            value: preset,
            label: presetLabel(preset),
          }))}
          labels={{
            mode: t("mode"),
            features: t("features"),
            featuresHint: t("featuresHint", { slug: book.slug }),
            preview: t("preview"),
            previewHint: t("previewHint", { count: chapters }),
          }}
        />
      </ActionDialog>
    </div>
  );
}

async function BookAudit({ slug }: { slug: string }) {
  const t = await getTranslations("education.book");
  const result = await load(() =>
    services().education.audit({ targetId: slug, limit: 10 }),
  );
  return (
    <Panel
      id="book-audit"
      title={t("auditTitle")}
      action={
        <PanelLink href={`/education/audit?book=${slug}`}>
          {t("allAudit")}
        </PanelLink>
      }
    >
      {!result.ok ? (
        <FailureState
          failure={result}
          what={t("auditWhat")}
          service={t("service")}
        />
      ) : result.data.items.length === 0 ? (
        <EmptyState size="sm" title={t("noAudit")} />
      ) : (
        <AuditFeed
          showSource={false}
          entries={result.data.items.map((entry) => ({
            ...entry,
            source: "education" as const,
          }))}
        />
      )}
    </Panel>
  );
}

/** One book: status, who reads it, how far readers get, and its log. */
export default async function BookPage({ params }: { params: Params<"slug"> }) {
  const access = await pageAccess("edu.read");
  if (!access.ok) return access.element;
  const { slug } = await params;
  const t = await getTranslations("education.book");
  const label = await getLabels();
  const f = await getFormatter();
  const words = await getRuleWords();
  const back = <BackLink href="/education/books">{t("back")}</BackLink>;
  const result = isBookSlug(slug)
    ? await load(() => services().education.book(slug))
    : ({ ok: false, kind: "not-found" } as const);
  if (!result.ok) {
    return (
      <Panel
        action={back}
        kind={result.kind === "not-connected" ? "not-connected" : undefined}
      >
        <FailureState
          failure={result}
          what={t("what")}
          service={t("service")}
        />
      </Panel>
    );
  }
  const { book, chapters } = result.data;
  const rule = words(book.rule, book.slug);
  const free = book.rule.mode === "grant" ? book.rule.previewChapters : null;
  const share = (part: number) =>
    book.readers > 0 ? f.percent(part / book.readers) : "—";

  return (
    <>
      <Panel id="book" kicker={t("kicker")} title={book.title} action={back}>
        <div className="stats">
          <Stat label={t("readers")} value={f.number(book.readers)} size="lg" />
          <Stat label={t("chapters")} value={f.number(book.stats.chapters)} />
          <Stat label={t("exercises")} value={f.number(book.stats.exercises)} />
          <Stat label={t("cards")} value={f.number(book.stats.cards)} />
          <Stat label={t("figures")} value={f.number(book.stats.figures)} />
          <Stat label={t("explain")} value={f.number(book.stats.explain)} />
          <Stat label={t("sandboxes")} value={f.number(book.stats.sandboxes)} />
        </div>
        <Facts
          cols={2}
          items={[
            {
              label: t("status"),
              value: (
                <Status tone={toneOf("book", book.status)}>
                  {label("bookStatus", book.status)}
                </Status>
              ),
            },
            {
              label: t("access"),
              value: (
                <span className="stack-xs">
                  <strong>{rule.title}</strong>
                  <span className="small muted">{rule.detail}</span>
                  {rule.features.length > 0 && (
                    <span className="small mono">
                      {rule.features.map(grantTargetOf).join(" · ")}
                    </span>
                  )}
                </span>
              ),
            },
            {
              label: t("content"),
              value: (
                <>
                  <span className="mono">
                    {t("version", { version: book.contentVersion })}
                  </span>
                  <span className="small muted mono" title={book.contentHash}>
                    {book.contentHash.slice(0, 12)}
                  </span>
                </>
              ),
            },
            { label: t("imported"), value: <Time iso={book.importedAt} /> },
            {
              label: t("published"),
              value: book.publishedAt ? (
                <Time iso={book.publishedAt} />
              ) : (
                <span className="muted">{t("never")}</span>
              ),
            },
            { label: t("updated"), value: <Time iso={book.updatedAt} /> },
          ]}
        />
        {access.granted.has("edu.manage") && (
          <BookCommands
            book={book}
            chapters={chapters.length || book.stats.chapters}
          />
        )}
      </Panel>

      <Panel
        flush
        id="chapters"
        title={t("chaptersTitle")}
        note={t("chaptersNote")}
      >
        <DataTable label={t("chaptersTitle")}>
          <thead>
            <tr>
              <th scope="col">{t("colChapter")}</th>
              <th scope="col" className="num">
                {t("colExercises")}
              </th>
              <th scope="col" className="num">
                {t("colCards")}
              </th>
              <th scope="col" className="num">
                {t("colReached")}
              </th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((chapter) => (
              <tr key={chapter.n}>
                <td data-primary="">
                  <span className="cell-main">
                    {chapter.n}. {chapter.short}
                    {free !== null && chapter.n <= free && (
                      <>
                        {" "}
                        <span className="chip" data-tone="muted">
                          {t("freeChapter")}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="cell-sub">{chapter.title}</span>
                </td>
                <td data-label={t("colExercises")} className="num">
                  {f.number(chapter.exercises)}
                </td>
                <td data-label={t("colCards")} className="num">
                  {f.number(chapter.cards)}
                </td>
                <td data-label={t("colReached")} className="num">
                  {/* One wrapper: a phone card keeps the count and share together. */}
                  <span>
                    {f.number(chapter.reached)}
                    <span className="cell-sub">{share(chapter.reached)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      <Suspense
        fallback={
          <TableSkeleton
            label={t("readersTitle")}
            rows={4}
            withFilters={false}
          />
        }
      >
        <ReadersTable
          filter={{ book: book.slug }}
          title={t("readersTitle")}
          pager={false}
          limit={10}
          showBook={false}
          action={
            <PanelLink href={`/education/readers?book=${book.slug}`}>
              {t("allReaders")}
            </PanelLink>
          }
        />
      </Suspense>

      <Suspense
        fallback={<PanelSkeleton label={t("auditTitle")} stats={0} rows={4} />}
      >
        <BookAudit slug={book.slug} />
      </Suspense>
    </>
  );
}
