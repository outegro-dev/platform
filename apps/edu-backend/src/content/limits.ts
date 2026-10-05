import {
  type Block,
  type BookDocument,
  exerciseAttemptSchema,
} from "@outegro/contracts/edu";
import { isSafeSvg, MAX_ROWS, walkBlocks } from "@outegro/edu-engine";

/**
 * Whether a reader's attempt can report a result of this many columns: the
 * attempt schema's own limit, asked of the schema rather than copied.
 */
const reportableColumns = (columns: number) =>
  exerciseAttemptSchema.safeParse({
    kind: "sqlTask",
    columns,
    rowCount: 0,
    rows: [],
  }).success;

/**
 * What stops a book that passed its schema from being served as it is, each
 * naming where it is; none for a book ready to import. Every figure and the
 * cover must be book SVG (edu-web drops any other markup, so a figure would
 * silently disappear). Every SQL task's expected result must fit what a
 * reader's attempt reports — at most MAX_ROWS rows and the columns the
 * attempt schema takes — or the task could never be solved. The cells of a
 * result are checked by the converter, which runs the solutions; the server
 * never does.
 */
export function contentProblems(document: BookDocument): string[] {
  const problems: string[] = [];
  if (!isSafeSvg(document.cover)) problems.push("the cover is not book SVG");
  const parts: { where: string; blocks: readonly Block[] }[] = [
    ...(document.preface
      ? [{ where: "the preface", blocks: document.preface.blocks }]
      : []),
    ...document.chapters.map((chapter) => ({
      where: `chapter ${chapter.n}`,
      blocks: chapter.blocks,
    })),
  ];
  for (const { where, blocks } of parts) {
    let figures = 0;
    walkBlocks(blocks, (block) => {
      if (block.t === "figure") {
        figures++;
        if (!isSafeSvg(block.svg))
          problems.push(`${where}: figure ${figures} is not book SVG`);
      } else if (block.t === "sqlTask") {
        const { rows, columns } = block.expected;
        if (rows > MAX_ROWS)
          problems.push(
            `${block.id}: the solution returns ${rows} rows; an attempt reports at most ${MAX_ROWS}`,
          );
        if (!reportableColumns(columns))
          problems.push(
            `${block.id}: the solution returns ${columns} columns, more than an attempt reports`,
          );
      }
    });
  }
  return problems;
}
