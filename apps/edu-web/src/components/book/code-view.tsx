import { CopyButton } from "@outegro/ui/copy-button";
import { ScrollRegion } from "@/components/islands/scroll-region";

/** The words around a code block, in the book's language. */
export type CodeLabels = {
  copy: string;
  copied: string;
  copyFailed: string;
  output: string;
};

/**
 * A code block: a header with the title (or the language), a copy button,
 * the code (highlighted on the server when the language is known) and,
 * when the book gives it, what the code prints. Shared by the server
 * renderer and the SQL task's solution.
 */
export function CodeView({
  code,
  html,
  label,
  output,
  labels,
}: {
  code: string;
  /** highlight.js markup; null renders the code as plain text. */
  html: string | null;
  label: string;
  output?: string;
  labels: CodeLabels;
}) {
  return (
    <div className="code-group">
      <div className="code-block">
        <div className="code-head">
          <span className="code-title">{label}</span>
          {/* Icon only: the labels (a long one when the clipboard refuses)
              are its name and are announced, and the header keeps its width. */}
          <CopyButton
            value={code}
            label={labels.copy}
            copiedLabel={labels.copied}
            failedLabel={labels.copyFailed}
            size="icon-sm"
            className="code-copy"
          />
        </div>
        <ScrollRegion className="code-scroll" label={label}>
          <pre className="code-pre">
            {html === null ? (
              <code>{code}</code>
            ) : (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js output of the book's own code, escaped by the highlighter
              <code dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </pre>
        </ScrollRegion>
      </div>
      {output !== undefined ? (
        <OutputView text={output} label={labels.output} attached />
      ) : null}
    </div>
  );
}

/** What a program prints, under its code or on its own. */
export function OutputView({
  text,
  label,
  attached = false,
}: {
  text: string;
  label: string;
  attached?: boolean;
}) {
  return (
    <div className="output-block" data-attached={attached || undefined}>
      <div className="code-head">
        <span className="code-title">{label}</span>
      </div>
      <ScrollRegion className="code-scroll" label={label}>
        <pre className="code-pre output-pre">
          <samp>{text}</samp>
        </pre>
      </ScrollRegion>
    </div>
  );
}
