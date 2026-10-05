/*
 * The "training database" reference (the `schema` block): the sandbox
 * seed's tables, their columns with declared types and primary keys, and
 * row counts — read from the seed script itself, so a page can show the
 * reference without running SQLite. The seed is plain DDL plus INSERT …
 * VALUES; a statement this reader does not understand (UPDATE, INSERT …
 * SELECT) makes the row counts unknown rather than wrong.
 */

export type SchemaColumn = { name: string; type: string; pk: boolean };
export type SchemaTable = {
  name: string;
  columns: SchemaColumn[];
  /** null when the seed changes rows in a way this reader cannot count. */
  rows: number | null;
};

/** Splits on `separator` outside quotes, comments and parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char === "'" || char === '"' || char === "`") {
      const end = closingQuote(text, i, char);
      current += text.slice(i, end + 1);
      i = end;
    } else if (char === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end - 1;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (char === "[") {
      const end = text.indexOf("]", i);
      const stop = end === -1 ? text.length - 1 : end;
      current += text.slice(i, stop + 1);
      i = stop;
    } else {
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (char === separator && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Index of the quote closing the one at `start` ('' and "" escape it). */
function closingQuote(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) i += 2;
      else return i;
    } else i++;
  }
  return text.length - 1;
}

function unquote(name: string): string {
  const trimmed = name.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "`" || first === "[") && trimmed.length > 1) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

// A quoted, bracketed, backticked or bare SQL name (one capture group).
const identifier = String.raw`("(?:[^"]|"")+"|\[[^\]]+\]|\`[^\`]+\`|[\w$]+)`;
const createTable = new RegExp(
  String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:${identifier}\s*\.\s*)?${identifier}\s*\(([\s\S]*)\)\s*(?:WITHOUT\s+ROWID|STRICT|,|\s)*$`,
  "i",
);
const insertValues = new RegExp(
  String.raw`^(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\s+(?:${identifier}\s*\.\s*)?${identifier}\s*(?:\([^)]*\)\s*)?VALUES\s*([\s\S]*)$`,
  "i",
);
const tableConstraint =
  /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i;
const columnConstraint =
  /\b(CONSTRAINT|PRIMARY|NOT|NULL|UNIQUE|CHECK|DEFAULT|COLLATE|REFERENCES|GENERATED|AS)\b/i;
const harmless =
  /^(BEGIN|COMMIT|END|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+VIEW|ANALYZE|PRAGMA\s+foreign_keys)\b/i;

function parseColumns(body: string): SchemaColumn[] {
  const columns: SchemaColumn[] = [];
  const primary = new Set<string>();
  for (const part of splitTopLevel(body, ",")) {
    if (tableConstraint.test(part)) {
      const keys = /PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(part)?.[1];
      if (keys)
        for (const key of keys.split(","))
          primary.add(
            unquote(key.replace(/\s+(ASC|DESC)\s*$/i, "")).toLowerCase(),
          );
      continue;
    }
    const match = new RegExp(`^${identifier}\\s*([\\s\\S]*)$`).exec(part);
    if (!match) continue;
    const name = unquote(match[1] ?? "");
    const rest = match[2] ?? "";
    const constraint = columnConstraint.exec(rest);
    const type = (constraint ? rest.slice(0, constraint.index) : rest)
      .replace(/\s+/g, " ")
      .trim();
    columns.push({
      name,
      type,
      pk: /\bPRIMARY\s+KEY\b/i.test(rest),
    });
  }
  for (const column of columns)
    if (primary.has(column.name.toLowerCase())) column.pk = true;
  return columns;
}

/** Tables of the seed in creation order, or null when it defines none. */
export function schemaFromSeed(seed: string): SchemaTable[] | null {
  const tables: SchemaTable[] = [];
  const byName = new Map<string, SchemaTable>();
  let countable = true;
  for (const statement of splitTopLevel(seed, ";")) {
    const created = createTable.exec(statement);
    if (created) {
      const name = unquote(created[2] ?? "");
      const table: SchemaTable = {
        name,
        columns: parseColumns(created[3] ?? ""),
        rows: 0,
      };
      tables.push(table);
      byName.set(name.toLowerCase(), table);
      continue;
    }
    const inserted = insertValues.exec(statement);
    if (inserted) {
      const table = byName.get(unquote(inserted[2] ?? "").toLowerCase());
      const tuples = splitTopLevel(inserted[3] ?? "", ",").filter((tuple) =>
        tuple.startsWith("("),
      ).length;
      if (!table || tuples === 0) countable = false;
      else if (table.rows !== null) table.rows += tuples;
      continue;
    }
    if (!harmless.test(statement)) countable = false;
  }
  if (!tables.length) return null;
  if (!countable) for (const table of tables) table.rows = null;
  return tables;
}
