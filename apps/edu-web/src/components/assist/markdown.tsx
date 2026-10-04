import { CopyButton } from "@outegro/ui/copy-button";
import { Fragment, type ReactNode } from "react";
import { ScrollRegion } from "@/components/islands/scroll-region";
import {
  type MdBlock,
  type MdInline,
  parseMarkdown,
} from "@/lib/assist/markdown";

/** The words around an answer's code blocks, in the book's language. */
export type AnswerCodeLabels = {
  /** The language's name ("JavaScript"), or the generic "Code". */
  language: (lang: string) => string;
  copy: string;
  copied: string;
  copyFailed: string;
};

function Inlines({ nodes }: { nodes: readonly MdInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.t) {
          case "code":
            // biome-ignore lint/suspicious/noArrayIndexKey: an answer only grows at its end
            return <code key={index}>{node.v}</code>;
          case "b":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: an answer only grows at its end
              <strong key={index}>
                <Inlines nodes={node.c} />
              </strong>
            );
          default:
            // biome-ignore lint/suspicious/noArrayIndexKey: an answer only grows at its end
            return <Fragment key={index}>{node.v}</Fragment>;
        }
      })}
    </>
  );
}

function CodeBlock({
  block,
  labels,
}: {
  block: Extract<MdBlock, { t: "code" }>;
  labels: AnswerCodeLabels;
}) {
  const label = labels.language(block.lang);
  return (
    <div className="code-block assist-code" data-open={block.open || undefined}>
      <div className="code-head">
        <span className="code-title">{label}</span>
        <CopyButton
          value={block.code}
          label={labels.copy}
          copiedLabel={labels.copied}
          failedLabel={labels.copyFailed}
          size="icon-sm"
          className="code-copy"
        />
      </div>
      <ScrollRegion className="code-scroll" label={label}>
        <pre className="code-pre">
          <code>{block.code}</code>
        </pre>
      </ScrollRegion>
    </div>
  );
}

function Block({
  block,
  labels,
}: {
  block: MdBlock;
  labels: AnswerCodeLabels;
}): ReactNode {
  switch (block.t) {
    case "p":
      return (
        <p>
          {block.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an answer only grows at its end
            <Fragment key={index}>
              {index ? <br /> : null}
              <Inlines nodes={line} />
            </Fragment>
          ))}
        </p>
      );
    case "heading":
      return (
        <p>
          <strong>
            <Inlines nodes={block.c} />
          </strong>
        </p>
      );
    case "ul":
      return (
        <ul>
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an answer only grows at its end
            <li key={index}>
              <Inlines nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol start={block.start === 1 ? undefined : block.start}>
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an answer only grows at its end
            <li key={index}>
              <Inlines nodes={item} />
            </li>
          ))}
        </ol>
      );
    case "code":
      return <CodeBlock block={block} labels={labels} />;
  }
}

/**
 * An answer of the assistant as React elements (never HTML from the
 * model): paragraphs, lists, bold, inline code and code blocks with their
 * language and a copy button. Works on a part of an answer while it
 * streams; blocks keep their places as text is added at the end.
 */
export function AssistMarkdown({
  text,
  labels,
}: {
  text: string;
  labels: AnswerCodeLabels;
}) {
  return (
    <>
      {parseMarkdown(text).map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: an answer only grows at its end
        <Block key={index} block={block} labels={labels} />
      ))}
    </>
  );
}
