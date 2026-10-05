import type { Block } from "@outegro/contracts/edu";
import { isSafeSvg, labelText, type SchemaTable } from "@outegro/edu-engine";
import { Surface } from "@outegro/ui/surface";
import { Fragment } from "react";
import { ExplainRow } from "@/components/assist/explain-row";
import { UnderstandingBox } from "@/components/assist/understanding-box";
import { EventLoopSimulator } from "@/components/islands/event-loop";
import { ExplainTabs } from "@/components/islands/explain-tabs";
import { FlashCards } from "@/components/islands/flash-cards";
import { Order } from "@/components/islands/order";
import { Quiz } from "@/components/islands/quiz";
import { ScrollRegion } from "@/components/islands/scroll-region";
import { Sort } from "@/components/islands/sort";
import { SqlPlay } from "@/components/islands/sql-play";
import { SqlTask } from "@/components/islands/sql-task";
import { highlight } from "@/lib/highlight";
import { type CodeLabels, CodeView, OutputView } from "./code-view";
import { InlineText } from "./inline";
import {
  type BlockContext,
  type BookTranslator,
  orderKey,
  quizKey,
  sortKey,
  sqlTaskKey,
} from "./prepare";

/** A chapter's own blocks (the top level only): where the assistant's helpers go. */
export type ChapterTools = { n: number; short: string };

/**
 * A book's blocks as the platform renders them: text and figures as
 * server-rendered HTML, exercises and the sandbox as client islands. The
 * source's section headings (h3/h4) become h2/h3 under the chapter's h1.
 * Words around the blocks come from the `book` messages in the book's
 * language (the context's translator). Given the `chapter`, the top level
 * of a chapter also gets the reading assistant: "explain it differently"
 * under every section heading, and "explain it in your own words" before
 * the recap (or at the end).
 */
export function Blocks({
  blocks,
  context,
  chapter,
}: {
  blocks: readonly Block[];
  context: BlockContext;
  chapter?: ChapterTools;
}) {
  const recap = chapter ? blocks.findIndex((block) => block.t === "recap") : -1;
  const ownWords = chapter ? (
    <UnderstandingBox chapter={chapter.n} short={chapter.short} />
  ) : null;
  return (
    <>
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a chapter's blocks never reorder
        <Fragment key={index}>
          {index === recap ? ownWords : null}
          <BlockView block={block} context={context} chapter={chapter} />
        </Fragment>
      ))}
      {recap === -1 ? ownWords : null}
    </>
  );
}

function ListView({
  block,
  context,
}: {
  block: Extract<Block, { t: "ul" | "ol" }>;
  context: BlockContext;
}) {
  const items = block.items.map((item, index) => {
    const only = item.length === 1 ? item[0] : undefined;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: list items never reorder
      <li key={index}>
        {only?.t === "p" ? (
          <InlineText nodes={only.c} />
        ) : (
          <Blocks blocks={item} context={context} />
        )}
      </li>
    );
  });
  return block.t === "ol" ? (
    <ol className="book-list">{items}</ol>
  ) : (
    <ul className="book-list">{items}</ul>
  );
}

function FigureView({ block }: { block: Extract<Block, { t: "figure" }> }) {
  const caption = labelText(block.caption);
  const safe = isSafeSvg(block.svg);
  if (!safe) console.error("[book] a figure failed the SVG whitelist");
  return (
    <figure className="figure">
      {safe ? (
        <ScrollRegion className="figure-scroll" label={caption}>
          <div
            className="figure-art"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from the importer's whitelist, checked again by isSafeSvg
            dangerouslySetInnerHTML={{ __html: block.svg }}
          />
        </ScrollRegion>
      ) : null}
      {block.caption.length ? (
        <figcaption>
          <InlineText nodes={block.caption} />
        </figcaption>
      ) : null}
    </figure>
  );
}

function TableView({ block }: { block: Extract<Block, { t: "table" }> }) {
  const label = block.head.map((cell) => labelText(cell)).join(" · ");
  return (
    <ScrollRegion className="table-scroll" label={label}>
      <table className="book-table">
        <thead>
          <tr>
            {block.head.map((cell, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: table columns never reorder
              <th key={index} scope="col">
                <InlineText nodes={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: table rows never reorder
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells follow the columns
                <td key={index}>
                  <InlineText nodes={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function SchemaView({
  tables,
  t,
}: {
  tables: SchemaTable[];
  t: BookTranslator;
}) {
  return (
    <div className="schema">
      <p className="schema-title">{t("schema.title")}</p>
      <ul className="schema-grid">
        {tables.map((table) => (
          <li key={table.name} className="schema-table">
            <p className="schema-name">
              <code>{table.name}</code>
              {table.rows !== null ? (
                <span className="schema-rows">
                  {t("sql.rows", { count: table.rows })}
                </span>
              ) : null}
            </p>
            <ul className="schema-columns">
              {table.columns.map((column) => (
                <li key={column.name}>
                  <span className="schema-column">{column.name}</span>
                  <span className="schema-type">
                    {column.type.toLowerCase()}
                    {column.pk ? ` · ${t("schema.primaryKey")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function codeLabels(t: BookTranslator): CodeLabels {
  return {
    copy: t("code.copy"),
    copied: t("code.copied"),
    copyFailed: t("code.copyFailed"),
    output: t("code.output"),
  };
}

function languageName(t: BookTranslator, lang: string | undefined) {
  if (!lang) return t("code.code");
  const key = `code.languages.${lang}`;
  return t.has(key) ? t(key) : lang;
}

function BlockView({
  block,
  context,
  chapter,
}: {
  block: Block;
  context: BlockContext;
  /** Set for the chapter's own top-level blocks only. */
  chapter?: ChapterTools;
}) {
  const { t } = context;
  switch (block.t) {
    case "p":
      return (
        <p>
          <InlineText nodes={block.c} />
        </p>
      );
    case "h3":
      return (
        <>
          <h2 id={block.id} className="book-h2">
            <InlineText nodes={block.c} />
          </h2>
          {chapter ? (
            <ExplainRow chapter={chapter.n} section={block.id} />
          ) : null}
        </>
      );
    case "h4":
      return (
        <h3 id={block.id} className="book-h3">
          <InlineText nodes={block.c} />
        </h3>
      );
    case "ul":
    case "ol":
      return <ListView block={block} context={context} />;
    case "code": {
      const lang = block.lang?.toLowerCase();
      return (
        <CodeView
          code={block.code}
          html={highlight(block.code, lang)}
          label={block.title ?? languageName(t, lang)}
          output={block.out}
          labels={codeLabels(t)}
        />
      );
    }
    case "out":
      return <OutputView text={block.text} label={t("code.output")} />;
    case "figure":
      return <FigureView block={block} />;
    case "table":
      return <TableView block={block} />;
    case "note":
      return (
        <div className="note" data-tone={block.tone} role="note">
          <p className="note-title">{block.title}</p>
          <Blocks blocks={block.body} context={context} />
        </div>
      );
    case "recap":
      return (
        <Surface className="recap">
          <p className="recap-title">{block.title}</p>
          <Blocks blocks={block.body} context={context} />
        </Surface>
      );
    case "details":
      return (
        <details className="details">
          <summary>
            <InlineText nodes={block.summary} />
          </summary>
          <div className="details-body">
            <Blocks blocks={block.body} context={context} />
          </div>
        </details>
      );
    case "explain":
      return (
        <ExplainTabs
          topic={block.topic}
          views={block.views.map((view) => ({
            kind: view.kind,
            content: <Blocks blocks={view.body} context={context} />,
          }))}
        />
      );
    case "quiz":
      return (
        <Quiz
          quiz={quizKey(block)}
          question={<Blocks blocks={block.q} context={context} />}
          options={block.options.map((option, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: options never reorder
            <InlineText key={index} nodes={option} />
          ))}
          explanation={<Blocks blocks={block.why} context={context} />}
        />
      );
    case "order":
      return (
        <Order
          order={orderKey(block)}
          question={<Blocks blocks={block.q} context={context} />}
          items={block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items are listed in their right order
            <InlineText key={index} nodes={item} />
          ))}
          explanation={<Blocks blocks={block.why} context={context} />}
        />
      );
    case "sort":
      return (
        <Sort
          sort={sortKey(block)}
          question={<Blocks blocks={block.q} context={context} />}
          buckets={block.buckets.map((bucket) => ({
            key: bucket.key,
            label: <InlineText nodes={bucket.c} />,
          }))}
          items={block.items.map((item) => ({
            content: <InlineText nodes={item.c} />,
            text: labelText(item.c),
          }))}
          explanation={<Blocks blocks={block.why} context={context} />}
        />
      );
    case "cards":
      return (
        <FlashCards
          cards={block.cards.map((card) => ({
            id: card.id,
            front: <InlineText nodes={card.front} />,
            back: <InlineText nodes={card.back} />,
          }))}
        />
      );
    case "sqlPlay":
      return <SqlPlay sql={block.sql} />;
    case "sqlTask":
      return (
        <SqlTask
          task={sqlTaskKey(block)}
          question={<Blocks blocks={block.q} context={context} />}
          hint={block.hint ? <InlineText nodes={block.hint} /> : null}
          solutionHtml={highlight(block.solution, "sql")}
        />
      );
    case "eventLoop":
      return context.simulator ? (
        <EventLoopSimulator scenarios={context.simulator} />
      ) : null;
    case "schema":
      return context.schema ? (
        <SchemaView tables={context.schema} t={t} />
      ) : null;
    default:
      return null;
  }
}
