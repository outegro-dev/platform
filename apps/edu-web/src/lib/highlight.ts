import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";

/*
 * Code is highlighted on the server, once, with only the languages the
 * books use (js, bash, json, sql; "text" and anything unknown stay plain).
 * The browser gets the markup and no highlighter. highlight.js output is
 * escaped text inside <span class="hljs-…"> elements: the one kind of HTML
 * (besides the importer's sanitized SVG) that the app injects.
 */
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("sql", sql);

const languages: Record<string, string> = {
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  json: "json",
  sql: "sql",
};

/** Highlighted markup, or null for a language the books do not use. */
export function highlight(
  code: string,
  lang: string | null | undefined,
): string | null {
  const language = lang ? languages[lang.toLowerCase()] : undefined;
  if (!language) return null;
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

/**
 * Splits highlighted markup into lines that are each well-formed: a span
 * that crosses a line break (a multi-line string or comment) is closed at
 * the end of the line and opened again on the next one.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = "";
  for (const [token] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+|</g)) {
    if (token === "\n") {
      lines.push(line + "</span>".repeat(open.length));
      line = open.join("");
    } else if (token.startsWith("<span")) {
      open.push(token);
      line += token;
    } else if (token === "</span>") {
      open.pop();
      line += token;
    } else {
      line += token;
    }
  }
  lines.push(line + "</span>".repeat(open.length));
  return lines;
}

/**
 * Lines of a snippet as highlighted markup, one entry per line (the event
 * loop simulator marks the current one). Falls back to escaped text.
 */
export function highlightLines(
  lines: readonly string[],
  lang: string,
): string[] {
  const html = highlight(lines.join("\n"), lang);
  if (html !== null) {
    const split = splitHighlightedLines(html);
    if (split.length === lines.length) return split;
  }
  return lines.map(escapeHtml);
}
