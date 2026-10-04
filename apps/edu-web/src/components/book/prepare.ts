import type { Block, EventLoopScenario } from "@outegro/contracts/edu";
import {
  type OrderBlock,
  type QuizBlock,
  resolveEventLoopSteps,
  type SchemaTable,
  type SortBlock,
  type SqlTaskBlock,
  schemaFromSeed,
  walkBlocks,
} from "@outegro/edu-engine";
import { getTranslations } from "next-intl/server";
import { highlightLines } from "@/lib/highlight";
import type { SimulatorScenario } from "@/stores/simulator-store";

/** The book's words on the server, in the book's own language. */
export type BookTranslator = Awaited<ReturnType<typeof getTranslations>>;

/** What the blocks of one page share, prepared once on the server. */
export type BlockContext = {
  t: BookTranslator;
  /** The event loop simulator's scenarios, when the chapter has one. */
  simulator: SimulatorScenario[] | null;
  /** The training database's tables, when the page shows them. */
  schema: SchemaTable[] | null;
};

/**
 * The simulator's scenarios as the island needs them: code lines already
 * highlighted, every step resolved to a full state (so the browser gets
 * neither the highlighter nor the contract's schemas).
 */
export function prepareSimulator(
  eventLoop: { scenarios: EventLoopScenario[] } | null,
): SimulatorScenario[] | null {
  if (!eventLoop?.scenarios.length) return null;
  return eventLoop.scenarios.map((scenario) => ({
    name: scenario.name,
    lines: highlightLines(scenario.code, "js"),
    steps: resolveEventLoopSteps(scenario),
  }));
}

function uses(blocks: readonly Block[], type: Block["t"]): boolean {
  let found = false;
  walkBlocks(blocks, (block) => {
    if (block.t === type) found = true;
  });
  return found;
}

/** Everything the blocks of one page share. */
export async function blockContext(input: {
  locale: string;
  blocks: readonly Block[];
  eventLoop: { scenarios: EventLoopScenario[] } | null;
  sandbox: { seed: string } | null;
}): Promise<BlockContext> {
  const t = await getTranslations({ locale: input.locale, namespace: "book" });
  return {
    t,
    simulator: uses(input.blocks, "eventLoop")
      ? prepareSimulator(input.eventLoop)
      : null,
    schema:
      input.sandbox && uses(input.blocks, "schema")
        ? schemaFromSeed(input.sandbox.seed)
        : null,
  };
}

/*
 * An exercise as its island's store checks it: the answer key and the
 * shape, without the text the server already renders (question,
 * explanation, option and item content), so the page carries it once.
 */

export const quizKey = (block: QuizBlock): QuizBlock => ({
  ...block,
  q: [],
  why: [],
  options: block.options.map(() => []),
});

export const orderKey = (block: OrderBlock): OrderBlock => ({
  ...block,
  q: [],
  why: [],
  items: block.items.map(() => []),
});

export const sortKey = (block: SortBlock): SortBlock => ({
  ...block,
  q: [],
  why: [],
  buckets: block.buckets.map((bucket) => ({ key: bucket.key, c: [] })),
  items: block.items.map((item) => ({ key: item.key, c: [] })),
});

export const sqlTaskKey = (block: SqlTaskBlock): SqlTaskBlock => ({
  ...block,
  q: [],
  hint: null,
});
